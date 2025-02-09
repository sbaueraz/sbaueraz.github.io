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

  if (!config.maximumWithdrawal)
    config.maximumWithdrawal = 1000000;
 
  initializeHistoricalData(sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical);

  if (config.spouse1FullSocialSecurity / 2 > config.spouse2FullSocialSecurity) {
    config.spouse2FullSocialSecurity = config.spouse1FullSocialSecurity / 2;
    if (config.spouse2RetirementAge > 67)
      config.spouse2RetirementAge = 67;
  } else if (config.spouse2FullSocialSecurity / 2 > config.spouse1FullSocialSecurity) {
    config.spouse1FullSocialSecurity = config.spouse1FullSocialSecurity / 2;
    if (config.spouse1RetirementAge > 67)
      config.spouse1RetirementAge = 67;
  }

  config.spouse1RetirementAgeInMonths = config.spouse1RetirementAge * 12;
  config.spouse2RetirementAgeInMonths = config.spouse2RetirementAge * 12;

  config.spouse1SocialSecurity = calculateSocialSecurity(config.spouse1FullSocialSecurity, config.spouse1RetirementAgeInMonths)
  config.spouse2SocialSecurity = calculateSocialSecurity(config.spouse2FullSocialSecurity, config.spouse2RetirementAgeInMonths)

  console.log(JSON.stringify(config, null, 2)); // Pretty print with 2 spaces  

  findGoalWithdrawal(config);

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
    let spouse1SocialSecurity = config.spouse1SocialSecurity;
    let spouse2SocialSecurity = config.spouse2SocialSecurity;
    let monthlyWithdrawal = config.monthlyWithdrawal;
    let maximumWithdrawal = config.maximumWithdrawal;
    let otherIncome = config.otherIncome;
    let inflationAggregate = 0.0;
    let inflationMonths = 0;
    let month = config.startMonth - 1;
    if (month < 0)
        month = 0;

    if (config.useGuardrails)
      console.log("max Withdrawal2", maximumWithdrawal);
  
    // Generate random returns for stocks and bonds
    let simulatedBond;
    let simulatedStock = [];
    let simulatedInflation = [];

    const result = simulateUsingHistorical(config.months+1, config);
    simulatedStock = result.sp500;
    simulatedInflation = result.inflation;
    simulatedBond = result.bonds;

    const appliedInflation = new Array(config.months);
    const appliedYearlyInflation = new Array(config.months);

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
      let socialSecurityIncome = (month + config.spouse1CurrentAge*12) > config.spouse1RetirementAgeInMonths ? spouse1SocialSecurity : 0;
      socialSecurityIncome += (month + config.spouse2CurrentAge*12) > config.spouse2RetirementAgeInMonths ? spouse2SocialSecurity : 0;

      // Total income for the month
      const totalIncome = otherIncome + socialSecurityIncome;

      // Total withdrawal for the month
      const netWithdrawal = monthlyWithdrawal - totalIncome;

      // Calculate returns based on allocation
      stockBalance *= (1 + simulatedStock[month]);
      bondBalance *= (1 + simulatedBond[month]);

      let ratio = config.bucketBondRatio;
      // 0 = "Smart bucketing"
      if (config.bucketBondRatio == 0) {
        if (simulatedBond[month] < simulatedStock[month] && simulatedStock[month] > 0) {
          ratio = .2
        } else if (simulatedBond[month] > simulatedStock[month] && simulatedStock[month] > 0) {
          ratio = .8;
        } else if (simulatedStock[month] < 0) {
          ratio = 1;
        } else {
          ratio = .5;
        }
        if (config.useGuardrails)
          console.log(month, " bond vs stock = ratio", simulatedBond[month], simulatedStock[month], ratio);
      }

      let bondWithdrawal = netWithdrawal * ratio;
      let stockWithdrawal = netWithdrawal * (1 - ratio);

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
        clonedConfig.maximumWithdrawal = maximumWithdrawal;
        clonedConfig.spouse1SocialSecurity = spouse1SocialSecurity;
        clonedConfig.spouse2SocialSecurity = spouse2SocialSecurity;
        clonedConfig.useGuardrails = false;

        if (self) {
            simulationSuccess = runSimulation(clonedConfig);

            let data = {
                chartNbr,
                step: month,
                spend: undoInflation(clonedConfig.monthlyWithdrawal, month, appliedYearlyInflation),
                upperGuardrail: config.guardrailHigh * 100,
                lowerGuardrail: config.guardrailLow * 100,
                currentScore: simulationSuccess * 100,
                stockSavings: undoInflation(stockBalance, month, appliedInflation),
                bondSavings: undoInflation(bondBalance, month, appliedInflation)
            };
            self.postMessage({command: "update", data: data});
        }

        if (simulationSuccess <= config.guardrailLow || simulationSuccess >= config.guardrailHigh && month <= (config.months - 2)) {
          monthlyWithdrawal = Math.min(findGoalWithdrawal(clonedConfig), maximumWithdrawal);
        }
      }

      inflationAggregate += simulatedInflation[month-1];
      inflationMonths ++;
      appliedInflation[month-1] = Math.max(simulatedInflation[month-1],0);
      if (inflationMonths % 12 == 0) {
        if (inflationAggregate > 0) {
          monthlyWithdrawal *= (1+inflationAggregate);
          spouse1SocialSecurity *= (1+inflationAggregate);
          spouse2SocialSecurity *= (1+inflationAggregate);
          maximumWithdrawal *= (1+inflationAggregate);
          if (config.otherIncomeIncreases)
            otherIncome *= (1+inflationAggregate);
          appliedYearlyInflation[month-1] = inflationAggregate;
        }

        inflationAggregate=0;
        inflationMonths=0;
      }
    }

    return stockBalance + bondBalance;
}
    
function findGoalWithdrawal(config) {
    const runs = config.runs;
    if (!config.initialWithdrawal)
        config.initialWithdrawal = (config.initialSavings * .05) / 12;

    // Initial scan with lower iterations to get close to the actual goal
    config.runs = 500;
    config.initialWithdrawal = findGoalWithdrawalInternal(config);

    // Increase iterations to desired number and try again
    config.runs = runs;

    let val = findGoalWithdrawalInternal(config);
    val = Math.floor(val / 100) * 100;
    config.monthlyWidthdrawal = val;

    return val;
}
  
function findGoalWithdrawalInternal(config) {
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

      if (simulationSuccess >= .999 && currentWithdrawal > config.maximumWithdrawal)
        return config.maximumWithdrawal;
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
  
  