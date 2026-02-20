/**
 * Finance Calculator — Pure Logic (no I/O)
 * All financial calculations: free budget, health score, projections.
 */
import type {
    FinancialProfile,
    OneTimeExpense,
    RecurringFixed,
    RecurringVariable,
    Subscription,
    FinancialProject,
} from "./finance-db.js";

// ── Free Budget ──────────────────────────────────────────────────────

export interface FreeBudgetResult {
    income: number;
    totalFixed: number;
    totalVariableEstimate: number;
    totalSubscriptions: number;
    totalProjectContributions: number;
    safetyMargin: number;
    freeBudget: number;
    alreadySpent: number;
    remaining: number;
}

export function calcFreeBudget(
    profile: FinancialProfile,
    fixedExpenses: RecurringFixed[],
    variableExpenses: RecurringVariable[],
    subscriptions: Subscription[],
    projects: FinancialProject[],
    monthOneTimeExpenses: OneTimeExpense[],
    safetyPct: number = 0.10
): FreeBudgetResult {
    const income = Number(profile.monthly_income);

    const totalFixed = fixedExpenses.reduce((s, e) => s + Number(e.amount), 0);

    const totalVariableEstimate = variableExpenses.reduce(
        (s, e) => s + Number(e.estimated_amount ?? 0), 0
    );

    // Monthly subscriptions only (yearly/weekly normalized to monthly)
    const totalSubscriptions = subscriptions.reduce((s, sub) => {
        const amt = Number(sub.amount);
        switch (sub.billing_cycle) {
            case "yearly": return s + amt / 12;
            case "weekly": return s + amt * 4.33;
            default: return s + amt; // monthly
        }
    }, 0);

    const totalProjectContributions = projects.reduce(
        (s, p) => s + Number(p.monthly_contribution), 0
    );

    const safetyMargin = income * safetyPct;

    const freeBudget = income
        - totalFixed
        - totalVariableEstimate
        - totalSubscriptions
        - totalProjectContributions
        - safetyMargin;

    const alreadySpent = monthOneTimeExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const remaining = freeBudget - alreadySpent;

    return {
        income,
        totalFixed,
        totalVariableEstimate,
        totalSubscriptions,
        totalProjectContributions,
        safetyMargin,
        freeBudget,
        alreadySpent,
        remaining,
    };
}

// ── Health Score (1–10) ──────────────────────────────────────────────

export interface HealthScoreResult {
    score: number;
    details: string[];
}

export function calcHealthScore(
    profile: FinancialProfile,
    budget: FreeBudgetResult,
    projects: FinancialProject[],
    totalMonthlyExpenses: number
): HealthScoreResult {
    let score = 5; // Base
    const details: string[] = [];
    const income = Number(profile.monthly_income);

    // 1. Income commitment ratio (ideal < 70%)
    const commitmentRatio = income > 0
        ? (budget.totalFixed + budget.totalVariableEstimate + budget.totalSubscriptions + budget.totalProjectContributions) / income
        : 1;

    if (commitmentRatio < 0.5) {
        score += 2;
        details.push("Excelente: menos de 50% da renda comprometida");
    } else if (commitmentRatio < 0.7) {
        score += 1;
        details.push("Bom: menos de 70% da renda comprometida");
    } else if (commitmentRatio < 0.9) {
        score -= 1;
        details.push("Atenção: mais de 70% da renda comprometida");
    } else {
        score -= 2;
        details.push("Crítico: mais de 90% da renda comprometida");
    }

    // 2. Emergency fund (goal: 6x monthly expenses)
    const emergencyGoal = Number(profile.emergency_fund_goal) || totalMonthlyExpenses * 6;
    const reserve = Number(profile.bank_reserve);

    if (reserve >= emergencyGoal && emergencyGoal > 0) {
        score += 2;
        details.push("Reserva de emergência completa ✅");
    } else if (reserve >= emergencyGoal * 0.5) {
        score += 1;
        details.push("Reserva parcial (>50% da meta)");
    } else {
        score -= 1;
        details.push("Reserva insuficiente — priorizar");
    }

    // 3. Long-term projects
    if (projects.length > 0) {
        score += 1;
        details.push(`${projects.length} projeto(s) financeiro(s) ativo(s)`);
    } else {
        details.push("Sem projetos de longo prazo — considere criar um");
    }

    // 4. One-time spending within budget
    if (budget.remaining >= 0) {
        score += 0.5;
        details.push("Gastos avulsos dentro do orçamento");
    } else {
        score -= 1;
        details.push("Gastos avulsos excederam o saldo livre ⚠️");
    }

    // Clamp 1-10
    score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));

    return { score, details };
}

// ── Project Projection ───────────────────────────────────────────────

export interface ProjectProjection {
    monthsRemaining: number;
    estimatedDate: string;
    percentage: number;
}

export function projectProjection(project: FinancialProject): ProjectProjection {
    const goal = Number(project.goal_amount);
    const current = Number(project.current_amount);
    const monthly = Number(project.monthly_contribution);

    const remaining = goal - current;
    const percentage = goal > 0 ? (current / goal) * 100 : 0;

    let monthsRemaining = 0;
    let estimatedDate = "N/A";

    if (monthly > 0 && remaining > 0) {
        monthsRemaining = Math.ceil(remaining / monthly);
        const date = new Date();
        date.setMonth(date.getMonth() + monthsRemaining);
        estimatedDate = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    } else if (remaining <= 0) {
        estimatedDate = "✅ Meta atingida!";
    }

    return { monthsRemaining, estimatedDate, percentage };
}

// ── Category Breakdown ───────────────────────────────────────────────

export function categoryBreakdown(
    fixedExpenses: RecurringFixed[],
    variableExpenses: RecurringVariable[],
    subscriptions: Subscription[],
    oneTimeExpenses: OneTimeExpense[]
): Record<string, number> {
    const cats: Record<string, number> = {};

    const add = (cat: string, amount: number) => {
        const key = cat || "geral";
        cats[key] = (cats[key] || 0) + Number(amount);
    };

    fixedExpenses.forEach(e => add(e.category, e.amount));
    variableExpenses.forEach(e => add(e.category, e.estimated_amount ?? 0));
    subscriptions.forEach(s => add(s.category, s.amount));
    oneTimeExpenses.forEach(e => add(e.category, e.amount));

    return cats;
}
