/**
 * Finance Tools — LLM Tool Registration
 * Registers ~19 finance tools for the agent to call via tool-calling.
 */
import { registerTool } from "../tools/registry.js";
import * as db from "./finance-db.js";
import * as calc from "./finance-calculator.js";
import * as fmt from "./finance-formatter.js";

// ── Helper: gather all data for budget calculation ───────────────────
async function gatherBudgetData(userId: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const profile = await db.getProfile(userId);
    if (!profile) throw new Error("Perfil financeiro não configurado. Configure com: 'minha renda é X, dia Y'");

    const [fixed, variable, subs, projects, expenses] = await Promise.all([
        db.listRecurringFixed(userId),
        db.listRecurringVariable(userId),
        db.listSubscriptions(userId),
        db.listProjects(userId),
        db.getMonthExpenses(userId, year, month),
    ]);

    const budget = calc.calcFreeBudget(profile, fixed, variable, subs, projects, expenses);
    return { profile, fixed, variable, subs, projects, expenses, budget };
}

// ══════════════════════════════════════════════════════════════════════
// PROFILE & INCOME
// ══════════════════════════════════════════════════════════════════════

registerTool({
    name: "finance_set_income",
    description: "Configura a renda mensal do usuário e o dia de pagamento. Ex: renda de 5000 que cai dia 5.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID do usuário" },
            monthly_income: { type: "number", description: "Valor da renda mensal" },
            income_day: { type: "integer", description: "Dia do mês que recebe o salário (1-31)" },
        },
        required: ["user_id", "monthly_income", "income_day"],
    },
    async execute(input) {
        await db.upsertProfile(input.user_id as string, {
            monthly_income: input.monthly_income as number,
            income_day: input.income_day as number,
        });
        return JSON.stringify({
            success: true,
            message: `✅ Renda configurada: R$ ${(input.monthly_income as number).toFixed(2)} | Pagamento todo dia ${input.income_day}`,
        });
    },
});

registerTool({
    name: "finance_update_balance",
    description: "Atualiza o saldo atual do usuário no banco.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            amount: { type: "number", description: "Saldo atual no banco" },
        },
        required: ["user_id", "amount"],
    },
    async execute(input) {
        await db.upsertProfile(input.user_id as string, {
            bank_reserve: input.amount as number,
        });
        return JSON.stringify({
            success: true,
            message: `🏦 Saldo atualizado: R$ ${(input.amount as number).toFixed(2)}`,
        });
    },
});

registerTool({
    name: "finance_get_profile",
    description: "Mostra o perfil financeiro do usuário (renda, saldo, reserva).",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        const profile = await db.getProfile(input.user_id as string);
        if (!profile) return JSON.stringify({ error: "Perfil não encontrado. Configure sua renda primeiro." });
        return fmt.formatProfile(profile);
    },
});

// ══════════════════════════════════════════════════════════════════════
// ONE-TIME EXPENSES
// ══════════════════════════════════════════════════════════════════════

registerTool({
    name: "finance_add_expense",
    description: "Registra um gasto avulso (compra única). Ex: 'gastei 120 no restaurante'.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            amount: { type: "number", description: "Valor do gasto" },
            description: { type: "string", description: "Descrição do gasto" },
            category: { type: "string", description: "Categoria (alimentação, lazer, transporte, saúde, etc). Default: geral" },
        },
        required: ["user_id", "amount", "description"],
    },
    async execute(input) {
        const userId = input.user_id as string;
        const amount = input.amount as number;
        const description = input.description as string;
        const category = (input.category as string) || "geral";

        await db.addOneTimeExpense({
            user_id: userId,
            description,
            amount,
            category,
            date: new Date().toISOString().split("T")[0],
        });

        // Calculate remaining budget
        try {
            const data = await gatherBudgetData(userId);
            return fmt.formatExpenseAdded(description, amount, data.budget.remaining);
        } catch {
            return JSON.stringify({ success: true, message: `✅ R$ ${amount.toFixed(2)} registrado — ${description}` });
        }
    },
});

// ══════════════════════════════════════════════════════════════════════
// RECURRING EXPENSES
// ══════════════════════════════════════════════════════════════════════

registerTool({
    name: "finance_add_recurring",
    description: "Adiciona uma despesa recorrente (fixa ou variável). Exemplos: aluguel R$1200 dia 10, conta de luz ~R$200 dia 15.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            type: { type: "string", enum: ["fixed", "variable"], description: "Tipo: 'fixed' (valor fixo) ou 'variable' (valor varia)" },
            description: { type: "string", description: "Descrição da despesa" },
            amount: { type: "number", description: "Valor (fixo) ou estimativa mensal (variável)" },
            due_day: { type: "integer", description: "Dia de vencimento (1-31)" },
            category: { type: "string", description: "Categoria (moradia, transporte, saúde, etc)" },
        },
        required: ["user_id", "type", "description", "amount", "due_day"],
    },
    async execute(input) {
        const userId = input.user_id as string;
        const type = input.type as string;
        const desc = input.description as string;
        const amount = input.amount as number;
        const dueDay = input.due_day as number;
        const category = (input.category as string) || (type === "fixed" ? "fixo" : "variável");

        if (type === "fixed") {
            await db.addRecurringFixed({ user_id: userId, description: desc, amount, due_day: dueDay, category });
        } else {
            await db.addRecurringVariable({ user_id: userId, description: desc, estimated_amount: amount, due_day: dueDay, category });
        }

        return JSON.stringify({
            success: true,
            message: `✅ Gasto ${type === "fixed" ? "fixo" : "variável"}: ${desc} — R$ ${amount.toFixed(2)} | Venc: dia ${dueDay}`,
        });
    },
});

registerTool({
    name: "finance_list_recurring",
    description: "Lista todos os gastos recorrentes (fixos e variáveis) do usuário.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        const userId = input.user_id as string;
        const [fixed, variable] = await Promise.all([
            db.listRecurringFixed(userId),
            db.listRecurringVariable(userId),
        ]);
        return fmt.formatRecurringList(fixed, variable);
    },
});

registerTool({
    name: "finance_remove_recurring",
    description: "Remove (desativa) um gasto recorrente fixo pelo ID.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            expense_id: { type: "string", description: "UUID do gasto a remover" },
        },
        required: ["user_id", "expense_id"],
    },
    async execute(input) {
        const ok = await db.removeRecurringFixed(input.user_id as string, input.expense_id as string);
        return JSON.stringify({ success: ok, message: ok ? "✅ Gasto removido." : "❌ Não encontrado." });
    },
});

// ══════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ══════════════════════════════════════════════════════════════════════

registerTool({
    name: "finance_add_subscription",
    description: "Adiciona uma assinatura de serviço (Netflix, Spotify, etc).",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            service_name: { type: "string", description: "Nome do serviço" },
            amount: { type: "number", description: "Valor da assinatura" },
            billing_cycle: { type: "string", enum: ["monthly", "yearly", "weekly"], description: "Ciclo: monthly, yearly, weekly" },
            due_day: { type: "integer", description: "Dia de cobrança (1-31)" },
        },
        required: ["user_id", "service_name", "amount", "billing_cycle"],
    },
    async execute(input) {
        await db.addSubscription({
            user_id: input.user_id as string,
            service_name: input.service_name as string,
            amount: input.amount as number,
            billing_cycle: input.billing_cycle as string,
            due_day: (input.due_day as number) ?? null,
            category: "assinatura",
            url: (input.url as string) ?? undefined,
        });
        const cycle = input.billing_cycle === "monthly" ? "/mês" : input.billing_cycle === "yearly" ? "/ano" : "/sem";
        return JSON.stringify({
            success: true,
            message: `✅ Assinatura: ${input.service_name} — R$ ${(input.amount as number).toFixed(2)}${cycle}`,
        });
    },
});

registerTool({
    name: "finance_list_subscriptions",
    description: "Lista todas as assinaturas ativas do usuário.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        const subs = await db.listSubscriptions(input.user_id as string);
        return fmt.formatSubscriptionList(subs);
    },
});

registerTool({
    name: "finance_cancel_subscription",
    description: "Cancela (desativa) uma assinatura pelo ID.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            subscription_id: { type: "string", description: "UUID da assinatura" },
        },
        required: ["user_id", "subscription_id"],
    },
    async execute(input) {
        const ok = await db.cancelSubscription(input.user_id as string, input.subscription_id as string);
        return JSON.stringify({ success: ok, message: ok ? "✅ Assinatura cancelada." : "❌ Não encontrada." });
    },
});

// ══════════════════════════════════════════════════════════════════════
// FINANCIAL ANALYSIS
// ══════════════════════════════════════════════════════════════════════

registerTool({
    name: "finance_free_budget",
    description: "Calcula quanto o usuário pode gastar 'à toa' este mês. Mostra saldo livre com breakdown.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        try {
            const data = await gatherBudgetData(input.user_id as string);
            return fmt.formatFreeBudget(data.budget);
        } catch (err: any) {
            return JSON.stringify({ error: err.message });
        }
    },
});

registerTool({
    name: "finance_monthly_summary",
    description: "Gera o resumo financeiro completo do mês atual.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        try {
            const userId = input.user_id as string;
            const data = await gatherBudgetData(userId);
            const totalMonthly = data.budget.totalFixed + data.budget.totalVariableEstimate + data.budget.totalSubscriptions;
            const health = calc.calcHealthScore(data.profile, data.budget, data.projects, totalMonthly);
            const cats = calc.categoryBreakdown(data.fixed, data.variable, data.subs, data.expenses);
            return fmt.formatMonthlySummary(
                data.budget, health, data.expenses, cats, data.projects, Number(data.profile.bank_reserve)
            );
        } catch (err: any) {
            return JSON.stringify({ error: err.message });
        }
    },
});

registerTool({
    name: "finance_category_breakdown",
    description: "Mostra gastos agrupados por categoria.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        try {
            const data = await gatherBudgetData(input.user_id as string);
            const cats = calc.categoryBreakdown(data.fixed, data.variable, data.subs, data.expenses);
            return fmt.formatCategoryBreakdown(cats);
        } catch (err: any) {
            return JSON.stringify({ error: err.message });
        }
    },
});

registerTool({
    name: "finance_calendar",
    description: "Mostra calendário de vencimentos de contas do mês.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        const userId = input.user_id as string;
        const [fixed, variable, subs] = await Promise.all([
            db.listRecurringFixed(userId),
            db.listRecurringVariable(userId),
            db.listSubscriptions(userId),
        ]);
        return fmt.formatCalendar(fixed, variable, subs);
    },
});

registerTool({
    name: "finance_health_score",
    description: "Calcula o score de saúde financeira do usuário (1 a 10).",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        try {
            const data = await gatherBudgetData(input.user_id as string);
            const totalMonthly = data.budget.totalFixed + data.budget.totalVariableEstimate + data.budget.totalSubscriptions;
            const health = calc.calcHealthScore(data.profile, data.budget, data.projects, totalMonthly);
            return fmt.formatHealthScore(health);
        } catch (err: any) {
            return JSON.stringify({ error: err.message });
        }
    },
});

// ══════════════════════════════════════════════════════════════════════
// FINANCIAL PROJECTS
// ══════════════════════════════════════════════════════════════════════

registerTool({
    name: "finance_create_project",
    description: "Cria um projeto/meta financeira (ex: quitar dívida, reserva de emergência, viagem).",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            name: { type: "string", description: "Nome do projeto" },
            goal_amount: { type: "number", description: "Meta em R$" },
            monthly_contribution: { type: "number", description: "Aporte mensal em R$" },
            deadline: { type: "string", description: "Data limite no formato YYYY-MM-DD (opcional)" },
            category: { type: "string", description: "Tipo: meta, aposentadoria, quitação, viagem, emergência, etc" },
        },
        required: ["user_id", "name", "goal_amount", "monthly_contribution"],
    },
    async execute(input) {
        const project = await db.createProject({
            user_id: input.user_id as string,
            name: input.name as string,
            goal_amount: input.goal_amount as number,
            monthly_contribution: input.monthly_contribution as number,
            deadline: input.deadline as string | undefined,
            category: (input.category as string) || "meta",
        });

        if (!project) return JSON.stringify({ error: "Erro ao criar projeto." });

        const projection = calc.projectProjection(project);
        return [
            `🎯 **Projeto criado!**`,
            `Meta: R$ ${(input.goal_amount as number).toFixed(2)}`,
            `Aporte mensal: R$ ${(input.monthly_contribution as number).toFixed(2)}`,
            `Previsão de conclusão: ${projection.monthsRemaining} meses (${projection.estimatedDate})`,
        ].join("\n");
    },
});

registerTool({
    name: "finance_list_projects",
    description: "Lista todos os projetos financeiros ativos do usuário.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
        },
        required: ["user_id"],
    },
    async execute(input) {
        const projects = await db.listProjects(input.user_id as string);
        return fmt.formatProjectList(projects);
    },
});

registerTool({
    name: "finance_contribute",
    description: "Registra um aporte (depósito) em um projeto financeiro.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            project_id: { type: "string", description: "UUID do projeto" },
            amount: { type: "number", description: "Valor do aporte" },
            note: { type: "string", description: "Nota opcional sobre o aporte" },
        },
        required: ["user_id", "project_id", "amount"],
    },
    async execute(input) {
        const userId = input.user_id as string;
        const projectId = input.project_id as string;
        const amount = input.amount as number;

        const ok = await db.addContribution(userId, projectId, amount, input.note as string);
        if (!ok) return JSON.stringify({ error: "Erro ao registrar aporte." });

        const project = await db.getProjectDetails(userId, projectId);
        if (!project) return JSON.stringify({ success: true, message: `✅ Aporte de R$ ${amount.toFixed(2)} registrado.` });

        const projection = calc.projectProjection(project);
        return fmt.formatProjectStatus(project, projection);
    },
});

registerTool({
    name: "finance_project_details",
    description: "Mostra progresso detalhado e projeção de um projeto financeiro.",
    parameters: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Telegram chat ID" },
            project_id: { type: "string", description: "UUID do projeto" },
        },
        required: ["user_id", "project_id"],
    },
    async execute(input) {
        const project = await db.getProjectDetails(input.user_id as string, input.project_id as string);
        if (!project) return JSON.stringify({ error: "Projeto não encontrado." });
        const projection = calc.projectProjection(project);
        return fmt.formatProjectStatus(project, projection);
    },
});

console.log("💰 Finance module loaded — 19 tools registered");
