"""Generate a synthetic sample dataset with 100+ factors for the scorecard builder demo.

Realistic missing/special value patterns:
- Missing values: common in bureau data, employment data, property data, income verification
- Special values (-999, 9999): common in bureau/external score fields where "not available"
  or "not applicable" is encoded as a sentinel rather than NULL
"""

import numpy as np
import pandas as pd

np.random.seed(42)
n = 20000


def inject_missing(arr: np.ndarray, frac: float) -> np.ndarray:
    out = arr.astype(float).copy()
    mask = np.random.random(len(out)) < frac
    out[mask] = np.nan
    return out


def inject_special(arr: np.ndarray, frac: float, value: float = -999.0) -> np.ndarray:
    out = arr.copy()
    mask = np.random.random(len(out)) < frac
    out[mask] = value
    return out


# ---------------------------------------------------------------------------
# Core factors (strong-to-moderate predictive power)
# ---------------------------------------------------------------------------
age = np.random.normal(40, 12, n).clip(18, 75)
income = np.random.lognormal(10.5, 0.6, n).clip(15000, 500000)
debt_to_income = np.random.beta(2, 5, n) * 0.8
months_employed = np.random.exponential(48, n).clip(0, 360)
credit_utilisation = np.random.beta(2, 3, n)
num_credit_lines = np.random.poisson(5, n).clip(0, 20).astype(float)
delinquency_count = np.random.poisson(0.5, n).clip(0, 10).astype(float)
loan_amount = np.random.lognormal(10, 0.8, n).clip(1000, 200000)
interest_rate = np.random.uniform(3, 25, n)
months_since_last_delinq = np.random.exponential(24, n).clip(0, 120)
revolving_balance = np.random.lognormal(8, 1.2, n).clip(0, 100000)
total_accounts = np.random.poisson(8, n).clip(1, 30).astype(float)
open_accounts = (total_accounts * np.random.beta(3, 2, n)).clip(1, 25)
max_delinquency_ever = np.random.choice([0, 1, 2, 3, 4, 5], n, p=[0.5, 0.2, 0.12, 0.08, 0.06, 0.04]).astype(float)
months_since_oldest_account = np.random.normal(180, 60, n).clip(12, 480)
inquiries_last_6m = np.random.poisson(1.5, n).clip(0, 15).astype(float)
payment_to_income = np.random.beta(2, 8, n) * 0.6
total_debt = income * debt_to_income * np.random.uniform(0.8, 1.2, n)
savings_balance = np.random.lognormal(9, 1.5, n).clip(0, 500000)
loan_to_value = np.random.beta(3, 2, n)

# ---------------------------------------------------------------------------
# Target variable
# ---------------------------------------------------------------------------
log_odds = (
    -3.0
    + 0.015 * (age - 40)
    - 0.4 * np.log(income / 50000)
    + 1.8 * debt_to_income
    - 0.008 * months_employed
    + 1.3 * credit_utilisation
    + 0.2 * delinquency_count
    + 0.25 * np.log(loan_amount / 20000)
    + 0.04 * interest_rate
    - 0.015 * months_since_last_delinq
    + 0.3 * np.log1p(revolving_balance / 5000)
    - 0.05 * open_accounts
    + 0.25 * max_delinquency_ever
    - 0.002 * months_since_oldest_account
    + 0.1 * inquiries_last_6m
    + 1.5 * payment_to_income
    + 0.15 * np.log1p(total_debt / 10000)
    - 0.15 * np.log1p(savings_balance / 10000)
    + 0.8 * loan_to_value
)
prob = 1 / (1 + np.exp(-log_odds))
default_flag = (np.random.uniform(0, 1, n) < prob).astype(int)

# ---------------------------------------------------------------------------
# Build the DataFrame
# ---------------------------------------------------------------------------
data = {}

# -- Core factors (clean) --
data["age"] = np.round(age, 1)
data["loan_amount"] = np.round(loan_amount, 2)
data["interest_rate"] = np.round(interest_rate, 2)
data["loan_to_value"] = np.round(loan_to_value, 4)

# -- Core factors with MISSING and/or SPECIAL values --
data["income"] = inject_special(inject_missing(np.round(income, 2), 0.04), 0.06, -999.0)
data["debt_to_income"] = inject_special(inject_missing(np.round(debt_to_income, 4), 0.06), 0.05, -999.0)
data["months_employed"] = inject_special(inject_missing(np.round(months_employed, 1), 0.10), 0.08, -999.0)
data["credit_utilisation"] = inject_special(inject_missing(np.round(credit_utilisation, 4), 0.03), 0.04, -999.0)
data["num_credit_lines"] = inject_special(inject_missing(num_credit_lines, 0.05), 0.06, -999.0)
data["delinquency_count"] = inject_special(inject_missing(delinquency_count, 0.07), 0.09, -999.0)
data["revolving_balance"] = inject_special(inject_missing(np.round(revolving_balance, 2), 0.08), 0.05, -999.0)
data["total_accounts"] = inject_special(inject_missing(total_accounts, 0.04), 0.05, -999.0)
data["open_accounts"] = inject_special(inject_missing(np.round(open_accounts, 0), 0.05), 0.06, -999.0)
data["max_delinquency_ever"] = inject_special(inject_missing(max_delinquency_ever, 0.09), 0.07, -999.0)
data["months_since_oldest_account"] = inject_special(inject_missing(np.round(months_since_oldest_account, 1), 0.06), 0.05, 9999.0)
data["inquiries_last_6m"] = inject_special(inject_missing(inquiries_last_6m, 0.04), 0.06, -999.0)
data["payment_to_income"] = inject_special(inject_missing(np.round(payment_to_income, 4), 0.08), 0.05, -999.0)
data["total_debt"] = inject_special(inject_missing(np.round(total_debt, 2), 0.07), 0.06, -999.0)
data["savings_balance"] = inject_special(inject_missing(np.round(savings_balance, 2), 0.12), 0.07, -999.0)
data["months_since_last_delinq"] = inject_special(inject_missing(np.round(months_since_last_delinq, 1), 0.15), 0.10, 9999.0)

# -- Correlated variants (some clean, some with missings to test clustering) --
data["income_log"] = inject_special(inject_missing(np.round(np.log(income), 4), 0.04), 0.06, -999.0)
data["income_scaled"] = inject_special(inject_missing(np.round(income / 1000, 2), 0.04), 0.06, -999.0)
data["income_with_noise"] = inject_special(inject_missing(np.round(income * (1 + np.random.normal(0, 0.1, n)), 2), 0.05), 0.05, -999.0)
data["debt_ratio_v2"] = inject_special(inject_missing(np.round(debt_to_income * np.random.uniform(0.9, 1.1, n), 4), 0.06), 0.05, -999.0)
data["employment_years"] = inject_special(inject_missing(np.round(months_employed / 12, 2), 0.10), 0.08, -999.0)
data["utilisation_pct"] = inject_special(inject_missing(np.round(credit_utilisation * 100, 2), 0.03), 0.04, -999.0)
data["revolving_to_income"] = inject_special(inject_missing(np.round(revolving_balance / income, 4), 0.09), 0.06, -999.0)
data["delinq_flag"] = inject_special(inject_missing((delinquency_count > 0).astype(float), 0.07), 0.05, -999.0)
data["high_utilisation_flag"] = inject_missing((credit_utilisation > 0.7).astype(float), 0.03)
data["loan_amount_log"] = np.round(np.log(loan_amount), 4)
data["total_debt_log"] = inject_special(inject_missing(np.round(np.log1p(total_debt), 4), 0.07), 0.06, -999.0)
data["savings_log"] = inject_special(inject_missing(np.round(np.log1p(savings_balance), 4), 0.12), 0.07, -999.0)
data["account_age_years"] = inject_special(inject_missing(np.round(months_since_oldest_account / 12, 2), 0.06), 0.05, 9999.0)

# -- Interaction / derived factors (with propagated missings) --
data["debt_service_ratio"] = inject_special(inject_missing(np.round(total_debt * interest_rate / 100 / income, 4), 0.10), 0.07, -999.0)
data["income_per_account"] = inject_special(inject_missing(np.round(income / total_accounts, 2), 0.06), 0.05, -999.0)
data["balance_per_line"] = inject_special(inject_missing(np.round(revolving_balance / num_credit_lines.clip(1), 2), 0.08), 0.06, -999.0)
data["utilisation_x_delinq"] = inject_special(inject_missing(np.round(credit_utilisation * delinquency_count, 4), 0.07), 0.05, -999.0)
data["ltv_x_rate"] = np.round(loan_to_value * interest_rate, 4)
data["age_x_income"] = inject_special(inject_missing(np.round(age * income / 100000, 4), 0.04), 0.05, -999.0)
data["open_to_total_ratio"] = inject_special(inject_missing(np.round(open_accounts / total_accounts, 4), 0.05), 0.04, -999.0)
data["inquiries_per_account"] = inject_special(inject_missing(np.round(inquiries_last_6m / total_accounts, 4), 0.06), 0.05, -999.0)

# -- Bureau/external data with SPECIAL VALUES (-999 = not on file, 9999 = not applicable) --
data["bureau_score"] = inject_special(inject_missing(np.random.normal(680, 70, n).clip(300, 850), 0.06), 0.12, -999.0)
data["bureau_score_v2"] = inject_special(inject_missing(np.random.normal(650, 80, n).clip(250, 900), 0.08), 0.10, -999.0)
data["external_score_1"] = inject_special(inject_missing(np.random.normal(650, 80, n).clip(300, 850), 0.05), 0.08, -999.0)
data["external_score_2"] = inject_special(inject_missing(np.random.normal(600, 100, n).clip(200, 900), 0.10), 0.12, -999.0)
data["external_score_3"] = inject_special(np.random.normal(700, 60, n).clip(350, 850), 0.07, -999.0)
data["months_since_default"] = inject_special(inject_missing(np.random.exponential(36, n).clip(0, 120), 0.08), 0.22, -999.0)
data["previous_applications"] = inject_special(inject_missing(np.random.poisson(2, n).clip(0, 15).astype(float), 0.04), 0.09, -999.0)
data["worst_status_12m"] = inject_special(inject_missing(np.random.choice([0, 1, 2, 3, 4], n, p=[0.6, 0.15, 0.1, 0.08, 0.07]).astype(float), 0.05), 0.14, -999.0)
data["worst_status_ever"] = inject_special(inject_missing(np.random.choice([0, 1, 2, 3, 4, 5], n, p=[0.45, 0.2, 0.12, 0.1, 0.08, 0.05]).astype(float), 0.06), 0.11, -999.0)
data["time_since_last_inquiry"] = inject_special(inject_missing(np.random.exponential(12, n).clip(0, 60), 0.05), 0.16, 9999.0)
data["avg_balance_6m"] = inject_special(inject_missing(np.random.lognormal(8, 1, n).clip(0, 80000), 0.07), 0.09, -999.0)
data["avg_balance_12m"] = inject_special(inject_missing(np.random.lognormal(8.2, 0.9, n).clip(0, 90000), 0.08), 0.10, -999.0)
data["max_overdue_amount"] = inject_special(inject_missing(np.random.exponential(500, n).clip(0, 10000), 0.06), 0.18, -999.0)
data["months_since_worst_delinq"] = inject_special(inject_missing(np.random.exponential(30, n).clip(0, 120), 0.09), 0.20, -999.0)
data["months_since_last_payment"] = inject_special(inject_missing(np.random.exponential(6, n).clip(0, 60), 0.07), 0.13, -999.0)
data["internal_rating_score"] = inject_special(inject_missing(np.random.normal(700, 60, n).clip(300, 850), 0.05), 0.10, -999.0)
data["bureau_num_trades"] = inject_special(inject_missing(np.random.poisson(6, n).clip(0, 25).astype(float), 0.04), 0.08, -999.0)
data["bureau_num_delinq_trades"] = inject_special(inject_missing(np.random.poisson(0.8, n).clip(0, 10).astype(float), 0.06), 0.11, -999.0)
data["bureau_total_balance"] = inject_special(inject_missing(np.random.lognormal(9, 1.3, n).clip(0, 200000), 0.08), 0.09, -999.0)
data["bureau_max_utilisation"] = inject_special(inject_missing(np.random.beta(2.5, 2, n), 0.05), 0.07, -999.0)
data["time_on_bureau"] = inject_special(inject_missing(np.random.normal(120, 50, n).clip(6, 360), 0.06), 0.08, 9999.0)
data["bureau_payment_history_score"] = inject_special(inject_missing(np.random.normal(75, 15, n).clip(0, 100), 0.07), 0.12, -999.0)

# -- Property/collateral data (high missing rates - not always applicable) --
data["property_value"] = inject_missing(np.random.lognormal(12, 0.5, n).clip(50000, 2000000), 0.25)
data["property_age_years"] = inject_missing(np.random.exponential(25, n).clip(0, 100), 0.28)
data["rental_income"] = inject_missing(np.random.exponential(500, n).clip(0, 5000), 0.40)
data["property_sqm"] = inject_missing(np.random.lognormal(4.5, 0.4, n).clip(20, 500), 0.30)

# -- Employment/personal data (moderate missing rates) --
data["dependants"] = inject_missing(np.random.poisson(1.2, n).clip(0, 8).astype(float), 0.08)
data["years_in_current_job"] = inject_missing(np.random.exponential(5, n).clip(0, 40), 0.15)
data["months_at_address"] = inject_missing(np.random.exponential(60, n).clip(1, 360), 0.10)
data["employer_tenure_months"] = inject_missing(months_employed * np.random.uniform(0.5, 1.0, n), 0.14)
data["other_loan_payments"] = inject_missing(np.random.exponential(300, n).clip(0, 3000), 0.11)
data["prev_loan_amount"] = inject_missing(np.random.lognormal(10, 0.7, n).clip(1000, 150000), 0.18)
data["net_monthly_income"] = inject_missing(np.round(income / 12 * np.random.uniform(0.65, 0.85, n), 2), 0.09)

# -- Pure noise / random factors (to test filtering by IV) --
for i in range(1, 16):
    data[f"noise_uniform_{i}"] = np.round(np.random.uniform(0, 1, n), 4)

for i in range(1, 8):
    data[f"noise_normal_{i}"] = np.round(np.random.normal(0, 1, n), 4)

for i in range(1, 4):
    data[f"noise_integer_{i}"] = np.random.randint(0, 100, n)

# -- Categorical factors --
data["region"] = np.random.choice(["North", "South", "East", "West", "Central"], n)
data["employment_type"] = np.random.choice(
    ["Salaried", "Self-employed", "Contract", "Retired", "Unemployed"],
    n, p=[0.45, 0.25, 0.15, 0.10, 0.05],
)
data["loan_purpose"] = np.random.choice(
    ["Purchase", "Refinance", "Home improvement", "Debt consolidation", "Other"],
    n, p=[0.30, 0.25, 0.20, 0.15, 0.10],
)
data["property_type"] = np.random.choice(
    ["House", "Flat", "Townhouse", "Other"],
    n, p=[0.40, 0.30, 0.20, 0.10],
)
data["education_level"] = np.random.choice(
    ["High school", "Bachelors", "Masters", "PhD", "Other"],
    n, p=[0.30, 0.35, 0.20, 0.05, 0.10],
)
data["marital_status"] = np.random.choice(
    ["Single", "Married", "Divorced", "Widowed"],
    n, p=[0.30, 0.45, 0.15, 0.10],
)

# -- Target --
data["default_flag"] = default_flag

df = pd.DataFrame(data)
df.to_csv("sample_factors.csv", index=False)

factor_count = len(df.columns) - 1
missing_factors = sum(1 for c in df.columns if df[c].isna().any())
special_factors = sum(1 for c in df.columns if c != "default_flag" and ((df[c] == -999).any() or (df[c] == 9999).any()))
both = sum(1 for c in df.columns if c != "default_flag" and df[c].isna().any() and ((df[c] == -999).any() or (df[c] == 9999).any()))

print(f"Generated {len(df)} rows, {factor_count} factors, default rate: {default_flag.mean():.2%}")
print(f"Factors with missing values (NaN): {missing_factors}")
print(f"Factors with special values (-999/9999): {special_factors}")
print(f"Factors with both missing AND special: {both}")
print(f"Numeric factors: {sum(1 for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != 'default_flag')}")
print(f"Categorical factors: {sum(1 for c in df.columns if not pd.api.types.is_numeric_dtype(df[c]))}")
