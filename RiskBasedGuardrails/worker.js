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
        const results = startSimulation(self, data, true);

        self.postMessage({command:"done", data: {results}});
    } catch (error) {
        console.error("error:", error);
    }
  } else if (command == "calculateInitialWithdrawalRate") {
    try {
        chartNbr = data.chartNbr;
        console.log("Calling run simulation");
        const results = startSimulation(self, data, false);

        self.postMessage({command:"done", data: {results}});
    } catch (error) {
        console.error("error:", error);
    }
  }
};

function startSimulation(self, data, runFullSimulation) {
  const {config, sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical} = data;
  config.stockAllocation = config.initialStockSavings / (config.initialStockSavings + config.initialBondSavings);
  config.stockBondWithdrawalRatio /= 100;
  config.guardrailHigh /= 100;
  config.guardrailLow /= 100;
  config.goalSuccess /= 100;

  // Calculate how many months based on current year - config.endYear
  const currentDate = new Date();   
  if (config.endYear && config.endYear > 0) {
    config.months = (config.endYear - currentDate.getFullYear() + 2) * 12; // +2 to include current year and end year
    config.months -= (12 - currentDate.getMonth()); // Adjust for current month
  } else if (!config.months || config.months <= 0)
    config.months = 30 * 12; // Default to 30 years if neither endYear nor months is set

  if (!config.maximumWithdrawal)
    config.maximumWithdrawal = 1000000;
 
  initializeHistoricalData(sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical);

  config.spouse1RetirementAgeInMonths = config.spouse1RetirementAge * 12;
  config.spouse2RetirementAgeInMonths = config.spouse2RetirementAge * 12;

  config.spouse1SocialSecurity = calculateBenefit(config.spouse1RetirementAgeInMonths, config.spouse2RetirementAgeInMonths, config.spouse1FullSocialSecurity, config.spouse2FullSocialSecurity);
  config.spouse2SocialSecurity = calculateBenefit(config.spouse2RetirementAgeInMonths, config.spouse1RetirementAgeInMonths, config.spouse2FullSocialSecurity, config.spouse1FullSocialSecurity);

  console.log(JSON.stringify(config, null, 2)); // Pretty print with 2 spaces  

  findGoalWithdrawal(config);

  if (runFullSimulation) {
    config.useGuardrails = true;
    monteCarloRetirement(self, config);
  }

  // Store initial (first year) social security amounts before inflation adjustments
  config.initialSpouse1SocialSecurity = config.spouse1SocialSecurity;
  config.initialSpouse2SocialSecurity = config.spouse2SocialSecurity;

  return config;
}

function initializeHistoricalData(sp500Historical, monthlyInflationHistorical, monthlyTreasuryBondHistorical) {

  for (let i = 0;i < sp500Historical.length;i ++) {
    let change = 0;
    if (i > 0 && sp500Historical[i-1].close > 0) {
      change = (sp500Historical[i].close - sp500Historical[i-1].close) / sp500Historical[i-1].close;
    }
    returnsSP500.push(change);
    returnsInflation.push(monthlyInflationHistorical[i].interest/100);
    returnsBonds.push(monthlyTreasuryBondHistorical[i].yield/100);
  }
}

function calculateBenefit(retireAgeMonths, spouseRetireAgeMonths, fraBenefit, spouseFraBenefit) {
  const FRA_MONTHS = 67 * 12;   // 804
  const EARLY_MIN = 62 * 12;    // 744
  const DELAY_MAX = 70 * 12;    // 840

  if (retireAgeMonths === 0 || fraBenefit === 0) return 0;

  const ownPIA = fraBenefit; // Primary Insurance Amount (at FRA)

  // --- Own Retirement Benefit ---
  let ownBenefit = ownPIA;

  if (retireAgeMonths < FRA_MONTHS) {
    let monthsEarly = FRA_MONTHS - retireAgeMonths;
    let reduction = 0;

    if (monthsEarly <= 36) {
      reduction = monthsEarly * (5 / 900); // 5/9 of 1% = 0.005555...
    } else {
      reduction = (36 * (5 / 900)) + ((monthsEarly - 36) * (5 / 1200));
      // 5/12 of 1% = 0.004166...
    }

    ownBenefit = ownPIA * (1 - reduction);
  } else if (retireAgeMonths > FRA_MONTHS) {
    let monthsDelayed = Math.min(retireAgeMonths, DELAY_MAX) - FRA_MONTHS;
    let increase = monthsDelayed * (2 / 300); // 2/3 of 1% = 0.006667 per month
    ownBenefit = ownPIA * (1 + increase);
  }

  // --- If no spouse, return own benefit only ---
  if (spouseRetireAgeMonths === 0 || spouseFraBenefit === 0) {
    return Math.round(ownBenefit);
  }

  // --- Spousal Benefit ---
  const maxSpousal = 0.5 * spouseFraBenefit;
  const spousalExcess = Math.max(0, maxSpousal - ownPIA);

  let finalSpousalExcess = spousalExcess;

  if (retireAgeMonths < FRA_MONTHS) {
    let monthsEarly = FRA_MONTHS - retireAgeMonths;
    let reduction = 0;

    if (monthsEarly <= 36) {
      reduction = monthsEarly * (25 / 3600); // 25/36 of 1% = 0.006944 per month
    } else {
      reduction = (36 * (25 / 3600)) + ((monthsEarly - 36) * (5 / 1200));
    }

    finalSpousalExcess = spousalExcess * (1 - reduction);
  }
  // At/after FRA → no reduction, no delayed credits.

  // --- Final Benefit ---
  let finalBenefit = ownBenefit + finalSpousalExcess;

  return Math.round(finalBenefit);
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

function runningAverage(arr, index, n) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  if (index < 0 || index >= arr.length || n <= 0) return 0;

  let start = Math.max(0, index - n + 1); // Ensure we don't go out of bounds
  let sum = 0;
  let count = 0;

  for (let i = start; i <= index; i++) {
      sum += arr[i];
      count++;
  }

  return count > 0 ? sum / count : 0;
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
      config.stockBalance = config.initialStockSavings;
    if (!config.bondBalance)
      config.bondBalance = config.initialBondSavings;

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
      let netWithdrawal = monthlyWithdrawal - totalIncome;

      // Calculate returns based on allocation
      stockBalance *= (1 + simulatedStock[month]);
      bondBalance *= (1 + simulatedBond[month]);

      if (netWithdrawal > stockBalance + bondBalance) {
        netWithdrawal = stockBalance + bondBalance;
      }
      //if (config.useGuardrails)
      //  console.log(month, "netWithdrawal", netWithdrawal, "totalIncome", totalIncome, "monthlyWithdrawal", monthlyWithdrawal, "socialSecurityIncome", socialSecurityIncome, "otherIncome", otherIncome);

      if (config.stockBondRebalanceInterval && month % config.stockBondRebalanceInterval == 0) {
        const balance = (stockBalance + bondBalance); 
        stockBalance = balance * config.stockAllocation;
        bondBalance = balance - stockBalance;
      }

      let ratio = config.stockBondWithdrawalRatio;
      // No setting = "Smart bucketing"
      if (!ratio) {
        const bondAvg = runningAverage(simulatedBond, month, 12);
        const stockAvg = runningAverage(simulatedStock, month, 12);
        if (bondAvg < stockAvg && stockAvg > 0) { // stock is doing better than bonds
          ratio = .2; // Pull 80% from stocks
        } else if (bondAvg > stockAvg && stockAvg > 0) { // bonds are doing better than stocks
          ratio = .8; // Pull 80% from bonds
        } else if (stockAvg < 0) { // stocks are going down
          ratio = 1; // Pull 100% from bonds
        } else { // Pull from both equally based on their allocation
          ratio = 1-config.stockAllocation;
        }
        //if (config.useGuardrails)
        //  console.log(month, " bond vs stock = ratio", (simulatedBond[month]*100).toFixed(1), (simulatedStock[month]*100).toFixed(1), (ratio*100).toFixed(1));
      }

      let bondWithdrawal = netWithdrawal * ratio;
      let stockWithdrawal = netWithdrawal * (1 - ratio);

      if (bondWithdrawal > bondBalance) {
        bondWithdrawal = bondBalance;
        stockWithdrawal = netWithdrawal - bondWithdrawal;
      } else if (stockWithdrawal > stockBalance) {
        stockWithdrawal = stockBalance;
        bondWithdrawal = netWithdrawal - stockWithdrawal;
      }

      //if (config.useGuardrails)
      //  console.log(month, "    ratio", ratio, "stock", stockBalance, "bond", bondBalance, "bondWithdrawal", bondWithdrawal, "stockWithdrawal", stockWithdrawal);

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
        clonedConfig.initialStockSavings = stockBalance;
        clonedConfig.initialBondSavings = bondBalance;
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
                bondSavings: undoInflation(bondBalance, month, appliedInflation),
                stockWithdrawal: undoInflation(stockWithdrawal, month, appliedInflation), 
                bondWithdrawal: undoInflation(bondWithdrawal, month, appliedInflation)
            };
            self.postMessage({command: "update", data: data});
        }

        if (simulationSuccess <= config.guardrailLow || (simulationSuccess >= config.guardrailHigh && month <= (config.months - 2))) {
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
        config.initialWithdrawal = ((config.initialStockSavings + config.initialBondSavings) * .05) / 12;

    // Initial scan with lower iterations to get close to the actual goal
    config.runs = 500;
    config.initialWithdrawal = findGoalWithdrawalInternal(config);

    // Increase iterations to desired number and try again
    config.runs = runs;

    let val = findGoalWithdrawalInternal(config);
    val = Math.floor(val / 100) * 100;
    config.monthlyWithdrawal = val;

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
        console.log("    Too many iterations looking for goal withdrawl, using $", currentWithdrawal," which gives ", simulationSuccess*100, "% success");
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
        console.log("Stopped at",simulationSuccess*100.0, "withdrawal of ", currentWithdrawal, "attempts", attempts, adjust, "balances",config.initialStockSavings, config.initialBondSavings);
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
  
  