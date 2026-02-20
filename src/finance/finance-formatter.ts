/**
 * Finance Formatter — Telegram Message Formatting
 * Formats financial data into beautiful pt-BR Telegram messages.
 */
import type { FreeBudgetResult, HealthScoreResult, ProjectProjection } from "./finance-calculator.js";
import type {
    FinancialProfile,
    RecurringFixed,
    RecurringVariable,
    Subscription,
    FinancialProject,
    OneTimeExpense,
} from "./finance-db.js";

// ── Helpers ──────────────────────────────────────────────────────────

function R$(value: number): string {
    return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthName(date?: Date): string {
    const d = date ?? new Date();
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function scoreEmoji(score: number): string {
    if (score >= 8) return "🟢";
    if (score >= 5) return "🟡";
    return "🔴";
}

function progressBar(pct: number, width: number = 10): string {
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
}

// ══════════════════════════════════════════════════════════════════════
// PUBLIC FORMATTERS
// ══════════════════════════════════════════════════════════════════════

export function formatProfile(profile: FinancialProfile): string {
    return [
        "**💼 PERFIL FINANCEIRO**",
        "",
        `💰 Renda mensal: **${R$(Number(profile.monthly_income))}**`,
        `📅 Dia do pagamento: **${profile.income_day}**`,
        `🏦 Saldo no banco: **${R$(Number(profile.bank_reserve))}**`,
        `🎯 Meta reserva emergência: **${R$(Number(profile.emergency_fund_goal))}**`,
    ].join("\n");
}

export function formatFreeBudget(budget: FreeBudgetResult): string {
    const lines = [
        `**📊 Análise de ${monthName()}**`,
        "",
        `💰 Renda: ${R$(budget.income)}`,
        `📌 **Comprometido:**`,
        `  • Fixos: ${R$(budget.totalFixed)}`,
        `  • Variáveis (est.): ${R$(budget.totalVariableEstimate)}`,
        `  • Assinaturas: ${R$(budget.totalSubscriptions)}`,
        `  • Projetos: ${R$(budget.totalProjectContributions)}`,
        `  • Margem segurança: ${R$(budget.safetyMargin)}`,
        "",
    ];

    if (budget.freeBudget >= 0) {
        lines.push(`✅ Saldo livre: **${R$(budget.freeBudget)}**`);
        lines.push(`🎯 Já gastou avulso: ${R$(budget.alreadySpent)}`);
        lines.push(`💸 Ainda pode gastar: **${R$(budget.remaining)}**`);
    } else {
        lines.push(`⚠️ **Déficit: ${R$(Math.abs(budget.freeBudget))}**`);
        lines.push("Suas despesas comprometem mais que sua renda. Revisão necessária.");
    }

    return lines.join("\n");
}

export function formatHealthScore(health: HealthScoreResult): string {
    const lines = [
        `**🏥 Saúde Financeira: ${health.score.toFixed(1)}/10 ${scoreEmoji(health.score)}**`,
        "",
        ...health.details.map(d => `• ${d}`),
    ];
    return lines.join("\n");
}

export function formatExpenseAdded(description: string, amount: number, remaining: number): string {
    const lines = [
        `✅ Gasto registrado: **${R$(amount)}** — ${description}`,
        `💸 Saldo livre restante: **${R$(remaining)}**`,
    ];
    return lines.join("\n");
}

export function formatRecurringList(
    fixed: RecurringFixed[],
    variable: RecurringVariable[]
): string {
    const lines = ["**📋 GASTOS RECORRENTES**", ""];

    if (fixed.length > 0) {
        lines.push("**Fixos:**");
        fixed.forEach(e => {
            lines.push(`  • **${e.description}**: ${R$(Number(e.amount))} | Venc: dia ${e.due_day} [${e.category}]`);
        });
    }

    if (variable.length > 0) {
        lines.push("", "**Variáveis:**");
        variable.forEach(e => {
            lines.push(`  • **${e.description}**: ~${R$(Number(e.estimated_amount ?? 0))} | Venc: dia ${e.due_day} [${e.category}]`);
        });
    }

    if (fixed.length === 0 && variable.length === 0) {
        lines.push("Nenhum gasto recorrente cadastrado.");
    }

    return lines.join("\n");
}

export function formatSubscriptionList(subs: Subscription[]): string {
    const lines = ["**📺 ASSINATURAS ATIVAS**", ""];

    if (subs.length === 0) {
        lines.push("Nenhuma assinatura cadastrada.");
        return lines.join("\n");
    }

    const total = subs.reduce((s, sub) => {
        const amt = Number(sub.amount);
        switch (sub.billing_cycle) {
            case "yearly": return s + amt / 12;
            case "weekly": return s + amt * 4.33;
            default: return s + amt;
        }
    }, 0);

    subs.forEach(s => {
        const cycle = s.billing_cycle === "monthly" ? "/mês" : s.billing_cycle === "yearly" ? "/ano" : "/sem";
        lines.push(`  • **${s.service_name}**: ${R$(Number(s.amount))}${cycle}${s.due_day ? ` | Venc: dia ${s.due_day}` : ""}`);
    });

    lines.push("", `💰 **Total mensal estimado: ${R$(total)}**`);
    return lines.join("\n");
}

export function formatProjectStatus(project: FinancialProject, projection: ProjectProjection): string {
    const pct = Math.min(100, projection.percentage);
    const lines = [
        `**🎯 ${project.name}**`,
        "",
        `${progressBar(pct)} ${pct.toFixed(1)}%`,
        `Meta: ${R$(Number(project.goal_amount))}`,
        `Atual: **${R$(Number(project.current_amount))}**`,
        `Aporte mensal: ${R$(Number(project.monthly_contribution))}`,
        `Previsão: **${projection.estimatedDate}** (${projection.monthsRemaining} meses)`,
    ];

    if (project.deadline) {
        lines.push(`Prazo: ${new Date(project.deadline).toLocaleDateString("pt-BR")}`);
    }

    return lines.join("\n");
}

export function formatProjectList(projects: FinancialProject[]): string {
    if (projects.length === 0) return "Nenhum projeto financeiro ativo.";

    const lines = ["**🎯 PROJETOS FINANCEIROS**", ""];
    projects.forEach(p => {
        const pct = Number(p.goal_amount) > 0
            ? ((Number(p.current_amount) / Number(p.goal_amount)) * 100).toFixed(0)
            : "0";
        lines.push(`  • **${p.name}**: ${R$(Number(p.current_amount))} / ${R$(Number(p.goal_amount))} (${pct}%) [${p.category}]`);
    });
    return lines.join("\n");
}

export function formatCalendar(
    fixed: RecurringFixed[],
    variable: RecurringVariable[],
    subs: Subscription[]
): string {
    type Entry = { day: number; label: string; amount: string };
    const entries: Entry[] = [];

    fixed.forEach(e => entries.push({ day: e.due_day, label: e.description, amount: R$(Number(e.amount)) }));
    variable.forEach(e => entries.push({ day: e.due_day, label: e.description, amount: `~${R$(Number(e.estimated_amount ?? 0))}` }));
    subs.filter(s => s.due_day).forEach(s => entries.push({ day: s.due_day!, label: s.service_name, amount: R$(Number(s.amount)) }));

    entries.sort((a, b) => a.day - b.day);

    const lines = [`**📆 Calendário de ${monthName()}**`, ""];

    if (entries.length === 0) {
        lines.push("Nenhuma conta cadastrada com vencimento.");
    } else {
        entries.forEach(e => {
            lines.push(`  **Dia ${String(e.day).padStart(2, "0")}** — ${e.label}: ${e.amount}`);
        });
    }

    return lines.join("\n");
}

export function formatCategoryBreakdown(cats: Record<string, number>): string {
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, v]) => s + v, 0);

    const lines = ["**📊 GASTOS POR CATEGORIA**", ""];
    sorted.forEach(([cat, amount]) => {
        const pct = total > 0 ? ((amount / total) * 100).toFixed(0) : "0";
        lines.push(`  • **${cat}**: ${R$(amount)} (${pct}%)`);
    });
    lines.push("", `**Total: ${R$(total)}**`);
    return lines.join("\n");
}

export function formatMonthlySummary(
    budget: FreeBudgetResult,
    health: HealthScoreResult,
    oneTimeExpenses: OneTimeExpense[],
    cats: Record<string, number>,
    projects: FinancialProject[],
    reserve: number
): string {
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const topCategory = sorted[0] ? `${sorted[0][0]} (${R$(sorted[0][1])})` : "N/A";
    const totalSpent = budget.totalFixed + budget.totalVariableEstimate + budget.totalSubscriptions + budget.alreadySpent;
    const projectTotal = projects.reduce((s, p) => s + Number(p.monthly_contribution), 0);

    return [
        `**📆 Resumo de ${monthName()}**`,
        "",
        `• Você gastou **${R$(totalSpent)}** de ${R$(budget.income)} de renda`,
        `• Maior categoria: **${topCategory}**`,
        `• Projetos: ${R$(projectTotal)} aportados`,
        `• Reserva atual: **${R$(reserve)}**`,
        "",
        `**Saúde financeira: ${health.score.toFixed(1)}/10 ${scoreEmoji(health.score)}**`,
    ].join("\n");
}
