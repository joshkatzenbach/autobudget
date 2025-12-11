// 2025 Federal Tax Brackets and Standard Deductions
export type FilingStatus = 'single' | 'married-jointly' | 'married-separately' | 'head-of-household';

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface TaxConfig {
  filingStatus: FilingStatus;
  standardDeduction: number;
  brackets: TaxBracket[];
}

// 2025 Standard Deductions (IRS inflation-adjusted)
const STANDARD_DEDUCTIONS: Record<FilingStatus, number> = {
  'single': 15750,
  'married-jointly': 31500,
  'married-separately': 15750,
  'head-of-household': 23625
};

// 2025 Federal Tax Brackets (Official IRS - Revenue Procedure 2024-55)
const TAX_BRACKETS: Record<FilingStatus, TaxBracket[]> = {
  'single': [
    { min: 0, max: 11925, rate: 10 },
    { min: 11926, max: 48475, rate: 12 },
    { min: 48476, max: 103350, rate: 22 },
    { min: 103351, max: 197300, rate: 24 },
    { min: 197301, max: 250525, rate: 32 },
    { min: 250526, max: 626350, rate: 35 },
    { min: 626351, max: Infinity, rate: 37 }
  ],
  'married-jointly': [
    { min: 0, max: 23850, rate: 10 },
    { min: 23851, max: 96950, rate: 12 },
    { min: 96951, max: 206700, rate: 22 },
    { min: 206701, max: 394600, rate: 24 },
    { min: 394601, max: 501050, rate: 32 },
    { min: 501051, max: 751600, rate: 35 },
    { min: 751601, max: Infinity, rate: 37 }
  ],
  'married-separately': [
    { min: 0, max: 11925, rate: 10 },
    { min: 11926, max: 48475, rate: 12 },
    { min: 48476, max: 103350, rate: 22 },
    { min: 103351, max: 197300, rate: 24 },
    { min: 197301, max: 250525, rate: 32 },
    { min: 250526, max: 375800, rate: 35 },
    { min: 375801, max: Infinity, rate: 37 }
  ],
  'head-of-household': [
    { min: 0, max: 17000, rate: 10 },
    { min: 17001, max: 64850, rate: 12 },
    { min: 64851, max: 103350, rate: 22 },
    { min: 103351, max: 197300, rate: 24 },
    { min: 197301, max: 250500, rate: 32 },
    { min: 250501, max: 626350, rate: 35 },
    { min: 626351, max: Infinity, rate: 37 }
  ]
};

export function getStandardDeduction(filingStatus: FilingStatus): number {
  return STANDARD_DEDUCTIONS[filingStatus];
}

export function getTaxBrackets(filingStatus: FilingStatus): TaxBracket[] {
  return TAX_BRACKETS[filingStatus];
}

export interface TaxBreakdown {
  bracket: string;
  rate: number;
  amount: number;
}

export interface TaxCalculationResult {
  taxableIncome: number;
  federalIncomeTax: {
    amount: number;
    effectiveRate: number;
    marginalRate: number;
    breakdown: TaxBreakdown[];
  };
  ficaTax: {
    socialSecurity: {
      amount: number;
      rate: number;
    };
    medicare: {
      amount: number;
      rate: number;
    };
    additionalMedicare: {
      amount: number;
      rate: number;
    };
    total: {
      amount: number;
      effectiveRate: number;
    };
  };
  federalTax: {
    amount: number; // Income tax + FICA
    effectiveRate: number;
  };
  stateTax: {
    amount: number;
    rate: number;
  };
  totalTax: {
    amount: number;
    effectiveRate: number;
  };
}

// Utah state tax rate (flat rate)
const UTAH_STATE_TAX_RATE = 4.95;

// 2025 FICA Tax Rates
const SOCIAL_SECURITY_RATE = 6.2; // Employee portion
const SOCIAL_SECURITY_WAGE_BASE = 176100; // 2025 wage base limit
const MEDICARE_RATE = 1.45; // Employee portion
const ADDITIONAL_MEDICARE_RATE = 0.9; // Additional Medicare tax
const ADDITIONAL_MEDICARE_THRESHOLD_SINGLE = 200000;
const ADDITIONAL_MEDICARE_THRESHOLD_MARRIED = 250000;

export function calculateTax(annualIncome: number, filingStatus: FilingStatus, deductions: number = 0): TaxCalculationResult {
  // Calculate taxable income (annual income - standard deduction - additional deductions)
  const standardDeduction = getStandardDeduction(filingStatus);
  const totalDeductions = standardDeduction + deductions;
  const taxableIncome = Math.max(0, annualIncome - totalDeductions);

  // Get brackets for filing status
  const brackets = getTaxBrackets(filingStatus);

  // Calculate federal tax using progressive brackets
  let federalTaxAmount = 0;
  let remainingIncome = taxableIncome;
  let marginalRate = 10;
  const federalBreakdown: TaxBreakdown[] = [];

  for (const bracket of brackets) {
    if (remainingIncome <= 0) break;

    const bracketMin = bracket.min;
    const bracketMax = bracket.max === Infinity ? taxableIncome : bracket.max;
    
    // Skip if taxable income hasn't reached this bracket yet
    if (taxableIncome < bracketMin) break;
    
    // Calculate how much income falls in this bracket
    const incomeInBracket = Math.min(
      remainingIncome,
      Math.min(taxableIncome, bracketMax) - bracketMin + 1
    );
    
    if (incomeInBracket > 0) {
      const bracketTax = incomeInBracket * (bracket.rate / 100);
      federalTaxAmount += bracketTax;
      remainingIncome -= incomeInBracket;

      // Add to breakdown
      const maxDisplay = bracket.max === Infinity ? '∞' : `$${bracket.max.toLocaleString()}`;
      federalBreakdown.push({
        bracket: `$${bracket.min.toLocaleString()} - ${maxDisplay}`,
        rate: bracket.rate,
        amount: bracketTax
      });

      // Check if taxable income falls in this bracket (for marginal rate)
      if (taxableIncome >= bracketMin && taxableIncome <= bracketMax) {
        marginalRate = bracket.rate;
      }
    }
  }

  const federalIncomeEffectiveRate = annualIncome > 0 ? (federalTaxAmount / annualIncome) * 100 : 0;

  // Calculate FICA taxes (Social Security and Medicare)
  // Social Security: 6.2% on income up to wage base limit
  const socialSecurityTaxableIncome = Math.min(annualIncome, SOCIAL_SECURITY_WAGE_BASE);
  const socialSecurityTax = socialSecurityTaxableIncome * (SOCIAL_SECURITY_RATE / 100);

  // Medicare: 1.45% on all income
  const medicareTax = annualIncome * (MEDICARE_RATE / 100);

  // Additional Medicare: 0.9% on income above threshold
  const additionalMedicareThreshold = filingStatus === 'married-jointly' 
    ? ADDITIONAL_MEDICARE_THRESHOLD_MARRIED 
    : ADDITIONAL_MEDICARE_THRESHOLD_SINGLE;
  const additionalMedicareTaxableIncome = Math.max(0, annualIncome - additionalMedicareThreshold);
  const additionalMedicareTax = additionalMedicareTaxableIncome * (ADDITIONAL_MEDICARE_RATE / 100);

  const totalFicaTax = socialSecurityTax + medicareTax + additionalMedicareTax;
  const ficaEffectiveRate = annualIncome > 0 ? (totalFicaTax / annualIncome) * 100 : 0;

  // Total federal tax (income tax + FICA)
  const totalFederalTax = federalTaxAmount + totalFicaTax;
  const totalFederalEffectiveRate = annualIncome > 0 ? (totalFederalTax / annualIncome) * 100 : 0;

  // Calculate Utah state tax (flat 4.95% on taxable income)
  // Note: Utah allows federal standard deduction, so we use the same taxable income
  const stateTaxAmount = taxableIncome * (UTAH_STATE_TAX_RATE / 100);
  const stateEffectiveRate = annualIncome > 0 ? (stateTaxAmount / annualIncome) * 100 : 0;

  // Total taxes (federal income + FICA + state)
  const totalTaxAmount = totalFederalTax + stateTaxAmount;
  const totalEffectiveRate = annualIncome > 0 ? (totalTaxAmount / annualIncome) * 100 : 0;

  return {
    taxableIncome,
    federalIncomeTax: {
      amount: federalTaxAmount,
      effectiveRate: federalIncomeEffectiveRate,
      marginalRate,
      breakdown: federalBreakdown
    },
    ficaTax: {
      socialSecurity: {
        amount: socialSecurityTax,
        rate: SOCIAL_SECURITY_RATE
      },
      medicare: {
        amount: medicareTax,
        rate: MEDICARE_RATE
      },
      additionalMedicare: {
        amount: additionalMedicareTax,
        rate: additionalMedicareTax > 0 ? ADDITIONAL_MEDICARE_RATE : 0
      },
      total: {
        amount: totalFicaTax,
        effectiveRate: ficaEffectiveRate
      }
    },
    federalTax: {
      amount: totalFederalTax, // Income tax + FICA combined
      effectiveRate: totalFederalEffectiveRate
    },
    stateTax: {
      amount: stateTaxAmount,
      rate: UTAH_STATE_TAX_RATE
    },
    totalTax: {
      amount: totalTaxAmount,
      effectiveRate: totalEffectiveRate
    }
  };
}

