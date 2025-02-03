const returnsSP500 = []; // Array to store simulated returns
const returnsInflation = [];
const returnsBonds = [];
var chartNbr;

self.onmessage = (e) => {
  const { command, data } = e.data;
  if (command == "start") {
    try {
        chartNbr = data.chartNbr;
        console.log("Calling run simulation");
        const results = startSimulation(self, data);

        self.postMessage({command:"done", data: {results}});
    } catch (error) {
        console.error("error:", error);
    }
  }
};

function startSimulation(self, data) {
  const {config, sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical} = data;
  config.stockAllocation /= 100;
  config.bucketBondRatio /= 100;
  config.guardrailHigh /= 100;
  config.guardrailLow /= 100;
  config.goalSuccess /= 100;
 
  initializeHistoricalData(sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical);

  config.retirementAgeInMonths = config.retirementAge * 12;
  if (!config.currentAgeInMonths)
    config.currentAgeInMonths = config.currentAge * 12;
  config.socialSecurity = calculateSocialSecurity(config.fullSocialSecurity, config.retirementAgeInMonths)

  console.log(JSON.stringify(config, null, 2)); // Pretty print with 2 spaces  

  console.log("Initial monthly withdrawal = ",findGoalWithdrawl(config));

  config.useGuardrails = true;
  monteCarloRetirement(self, config);

  return config;
}

function initializeHistoricalData(sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical) {

  for (let i = 0;i < sp500Historical.length;i ++) {
    let change = 0;
    if (i > 0 && sp500Historical[i-1].close1 > 0) {
      change = (sp500Historical[i].close1 - sp500Historical[i-1].close1) / sp500Historical[i-1].close1;
    }
    returnsSP500.push(change);
    returnsInflation.push(monthlyInflationHistorical[i].interest/100);
    returnsBonds.push(monthlyTreasuryBondHistorical[i].yield/100);
  }
}

// Function to calculate Social Security income based on full retirement amount and current age in months
function calculateSocialSecurity(fullRetirementAmount, currentAgeInMonths) {
    const fullRetirementAgeMonths = 67 * 12; // Full retirement age in months
  
    // Calculate early retirement reduction or delayed credits
    const monthsDifference = currentAgeInMonths - fullRetirementAgeMonths;
  
    let adjustmentFactor;
    if (monthsDifference < 0) {
        // Early retirement
        const earlyReductionPerMonth = 0.005; // 0.5% reduction per month
        adjustmentFactor = 1 + monthsDifference * earlyReductionPerMonth;
    } else {
        // Delayed retirement
        const delayedCreditPerMonth = 0.008; // 0.8% increase per month
        adjustmentFactor = 1 + monthsDifference * delayedCreditPerMonth;
    }
  
    // Adjustment factor should not exceed 1.24 (max delayed credits) or go below 0.7 (max early reduction)
    adjustmentFactor = Math.max(0.7, Math.min(1.24, adjustmentFactor));
  
    // Calculate monthly Social Security income
    const monthlyIncome = fullRetirementAmount * adjustmentFactor;
  
    return monthlyIncome.toFixed(2);
}

/**
 * Simulates monthly returns using an AR(1) model with annualized inputs.
 * @param {number} annualMeanReturn - Long-term annualized mean return (e.g., 0.06 for 6%).
 * @param {number} annualStdDev - Annualized standard deviation of returns (e.g., 0.15 for 15%).
 * @param {number} phi - Autoregression coefficient (e.g., 0.3 for moderate persistence).
 * @param {number} months - Number of months to simulate.
 * @returns {number[]} Array of simulated monthly returns.
 */
function simulateAR1(annualMeanReturn, annualStdDev, phi, months) {
    // Convert annualized values to monthly
    const monthlyMeanReturn = annualMeanReturn / 12;
    const monthlyStdDev = annualStdDev / Math.sqrt(12);
  
    // Initialize variables
    const randomGenerator = () => randomNormal(0, monthlyStdDev);  // Normal distribution for noise
    const returns = []; // Array to store simulated returns
  
    // Start with the first return equal to the monthly mean return
    let previousReturn = monthlyMeanReturn;
  
    for (let i = 0; i < months; i++) {
        // Generate the random noise term
        const epsilon = randomGenerator();
  
        // Apply the AR(1) formula
        const currentReturn = monthlyMeanReturn + phi * (previousReturn - monthlyMeanReturn) + epsilon;
  
        // Save the return
        returns.push(currentReturn);
  
        // Update the previous return
        previousReturn = currentReturn;
    }
  
    return returns;
}

//This function simulates the S&P 500 and inflation returns using historical data
function simulateUsingHistorical(months, config) {
    //Generate a random starting month
    let startMonth;
    if (config.useGuardrails && config.historicalYear)
        startMonth = Math.floor((config.historicalYear - 1928) * 12);
    else
        startMonth = Math.floor(Math.random() * (returnsSP500.length - months));
  
    //Slice the S&P 500 and inflation returns from the historical data using the random starting month
    const sp500 = returnsSP500.slice(startMonth, startMonth+months);
    const inflation = returnsInflation.slice(startMonth, startMonth+months);
    const bonds = returnsBonds.slice(startMonth, startMonth+months);

    let len = months - sp500.length;
    if (len > 0) {
        sp500.push(...returnsSP500.slice(startMonth - len, startMonth));
        inflation.push(...returnsInflation.slice(startMonth - len, startMonth));
        bonds.push(...returnsBonds.slice(startMonth - len, startMonth));
    }

    //Return the S&P 500 and inflation returns
    return {sp500, inflation, bonds};
}

function monteCarloRetirement(self, config) {
    let socialSecurity = config.socialSecurity;
    let monthlyWithdrawal = config.monthlyWithdrawal;
    let inflationAggregate = 0.0;
    let inflationMonths = 0;
    let month = config.startMonth - 1;
    if (month < 0)
        month = 0;

    // Generate random returns for stocks and bonds
    let simulatedBond;
    let simulatedStock = [];
    let simulatedInflation = [];

    const result = simulateUsingHistorical(config.months+1, config);
    simulatedStock = result.sp500;
    simulatedInflation = result.inflation;
    simulatedBond = result.bonds;

    const appliedInflation = new Array(config.months);

    if (!config.stockBalance)
      config.stockBalance = config.initialSavings * config.stockAllocation;
    if (!config.bondBalance)
      config.bondBalance = config.initialSavings * (1.0 - config.stockAllocation);

    let stockBalance = config.stockBalance;
    let bondBalance = config.bondBalance;
  
    //if (config.useGuardrails) {
      //console.log("Bond  returns:", simulatedBond.map(num => (num*100).toFixed(1)).join("\n"));
      //console.log("  Stock positive count:", simulatedStock.filter(num => num > 0).length, simulatedStock.length);
      //console.log("  Stock negative count:", simulatedStock.filter(num => num <= 0).length);
      //console.log("  Stock average:", ((simulatedStock.reduce((sum, num) => sum + num, 0) * 100) / simulatedStock.length * 12).toFixed(2));
  
      //console.log("  Inflation positive count:", simulatedInflation.filter(num => num > 0).length, simulatedInflation.length);
      //console.log("  Inflation negative count:", simulatedInflation.filter(num => num <= 0).length);
      //console.log("  Inflation average:", ((simulatedInflation.reduce((sum, num) => sum + num, 0) * 100) / simulatedInflation.length * 12).toFixed(2));
      //console.log("  Bond positive count:", simulatedBond.filter(num => num > 0).length, simulatedBond.length);
      //console.log("  Bond negative count:", simulatedBond.filter(num => num <= 0).length);
      //console.log("  Bond average:", ((simulatedBond.reduce((sum, num) => sum + num, 0) * 100) / simulatedBond.length * 12).toFixed(2));
    //}

    for (; month <= config.months; month++) {
      // Add Social Security payments if past the age we pick
      const socialSecurityIncome = (month + config.currentAgeInMonths) > config.retirementAgeInMonths ? socialSecurity : 0;

      // Total income for the month
      const totalIncome = config.otherIncome + socialSecurityIncome;

      // Total withdrawal for the month
      const netWithdrawal = monthlyWithdrawal - totalIncome;

      // Calculate returns based on allocation
      stockBalance *= (1 + simulatedStock[month]);
      bondBalance *= (1 + simulatedBond[month]);

      let bondWithdrawal = netWithdrawal * config.bucketBondRatio;
      let stockWithdrawal = netWithdrawal * (1 - config.bucketBondRatio);

      if (bondWithdrawal > bondBalance) {
        stockWithdrawal = bondWithdrawal - bondBalance;
        bondWithdrawal = bondBalance;
      } else if (stockWithdrawal > stockBalance) {
        bondWithdrawal = stockWithdrawal - stockBalance;
        stockWithdrawal = stockBalance;
      }
  
      // Update savings after withdrawals
      stockBalance -= stockWithdrawal;
      bondBalance -= bondWithdrawal;
      if (stockBalance < 0)
        stockBalance = 0;
      if (bondBalance < 0)
        bondBalance = 0;
  
      // If savings are depleted, stop the simulation
      if ((!config.useGuardrails && (stockBalance + bondBalance) <= config.minimumBalance) || 
          ( config.useGuardrails && (stockBalance + bondBalance) <= 0)) {
        break;
      }
  
      if (config.useGuardrails) {
        const clonedConfig = structuredClone(config);
        clonedConfig.startMonth = month+1;  
        clonedConfig.stockBalance = stockBalance;
        clonedConfig.bondBalance = bondBalance;
        clonedConfig.initialSavings = stockBalance + bondBalance;
        clonedConfig.monthlyWithdrawal = monthlyWithdrawal;
        clonedConfig.socialSecurity = socialSecurity;
        clonedConfig.useGuardrails = false;

        if (self) {
            simulationSuccess = runSimulation(clonedConfig);

            let data = {
                chartNbr,
                step: month,
                spend: undoInflation(clonedConfig.monthlyWithdrawal, month, appliedInflation),
                upperGuardrail: config.guardrailHigh * 100,
                lowerGuardrail: config.guardrailLow * 100,
                currentScore: simulationSuccess * 100,
                stockSavings: undoInflation(stockBalance, month, appliedInflation),
                bondSavings: undoInflation(bondBalance, month, appliedInflation)
            };
            self.postMessage({command: "update", data: data});
        }

        if (simulationSuccess <= config.guardrailLow || simulationSuccess >= config.guardrailHigh && month <= (config.months - 2)) {
          monthlyWithdrawal = findGoalWithdrawl(clonedConfig);
        }
      }

      inflationAggregate += simulatedInflation[month-1];
      inflationMonths ++;
      appliedInflation[month-1] = 0;
      if (inflationMonths % 12 == 0) {
        if (inflationAggregate > 0) {
          monthlyWithdrawal *= (1+inflationAggregate);
          socialSecurity *= (1+inflationAggregate);
          appliedInflation[month-1] = inflationAggregate;
        }
  
        inflationAggregate=0;
        inflationMonths=0;
      }
    }

    return stockBalance + bondBalance;
}
    
function findGoalWithdrawl(config) {
    const runs = config.runs;
    if (!config.initialWithdrawal)
        config.initialWithdrawal = (config.initialSavings * .05) / 12;

    // Initial scan with lower iterations to get close to the actual goal
    config.runs = 500;
    config.initialWithdrawal = findGoalWithdrawlInternal(config);

    // Increase iterations to desired number and try again
    config.runs = runs;

    let val = findGoalWithdrawlInternal(config);
    val = Math.floor(val / 100) * 100;
    config.monthlyWidthdrawal = val;

    return val;
}
  
function findGoalWithdrawlInternal(config) {
    let currentWithdrawal = config.initialWithdrawal;
  
    config.monthlyWithdrawal = currentWithdrawal;
    let simulationSuccess = runSimulation(config);

    let attempts = 0;
    let adjust = (simulationSuccess - config.goalSuccess)*10000;
    while (simulationSuccess > config.goalSuccess + .003 || simulationSuccess < config.goalSuccess - .003) {
      currentWithdrawal += adjust;

      config.monthlyWithdrawal = currentWithdrawal;
      //console.log("   Retry", attempts, "at",simulationSuccess*100.0, "Trying a new withdrawal of", currentWithdrawal, "adjust =", adjust);
      simulationSuccess = runSimulation(config);

      if (++attempts > 400) {
        //console.log("    Too many iterations looking for goal withdrawl, using $", currentWithdrawal," which gives ", simulationSuccess*100, "% success");
        break;
      }

      let newAdjust = (simulationSuccess - config.goalSuccess)*10000;
      if ((newAdjust < 0) !== (adjust < 0)) {
        adjust = -adjust * .75;
      } else if (simulationSuccess == 1) {
        adjust *= 1.5;
      }
    }

    if (attempts >= 400) {
        console.log("Stopped at",simulationSuccess*100.0, "withdrawal of ", currentWithdrawal, "attempts", attempts, adjust, "balances",config.initialSavings);
    }
    //console.log("Success at",simulationSuccess*100.0, "withdrawal of ", currentWithdrawal, "attempts", attempts, adjust);

    return currentWithdrawal;
}

function runSimulation(config) {
    let fails = 0;
    let startMonth = 1;
    if (config.startMonth)
      startMonth = config.startMonth;
    for (let i = 0;i < config.runs;i ++) {
      // Example Usage
      config.startMonth = startMonth;
      const finalBalance = monteCarloRetirement(null, config);
      //console.log("finalBalance =", finalBalance);

      // Determine if savings ran out
      if (finalBalance && finalBalance < config.minimumBalance) {
        fails ++;
      }
    }

    let success=(1.0-(fails/config.runs));

    return success;
}

function randomNormal(mu = 0, sigma = 1) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); // Ensure u is not 0
    while(v === 0) v = Math.random(); // Ensure v is not 0
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mu + z * sigma;
}

function undoInflation(value, month, inflationRates) {
    // Iterate through the inflation rates in reverse order
    for (let i = month; i >= 0; i--) {
        if (!inflationRates[i])
          continue;
        const inflationFactor = 1 + inflationRates[i];
        value /= inflationFactor;
    }

    return value;
}
  
  