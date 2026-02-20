/**
 * Finance DB — Supabase Queries
 * All database operations for the finance module.
 */
import { getClient } from "../supabase-db.js";

// ── Types ────────────────────────────────────────────────────────────
export interface FinancialProfile {
    id?: string;
    user_id: string;
    monthly_income: number;
    income_day: number;
    bank_reserve: number;
    emergency_fund_goal: number;
}

export interface OneTimeExpense {
    id?: string;
    user_id: string;
    description: string;
    amount: number;
    category: string;
    date: string;
}

export interface RecurringFixed {
    id?: string;
    user_id: string;
    description: string;
    amount: number;
    due_day: number;
    category: string;
    active: boolean;
}

export interface RecurringVariable {
    id?: string;
    user_id: string;
    description: string;
    estimated_amount: number;
    due_day: number;
    category: string;
    active: boolean;
}

export interface Subscription {
    id?: string;
    user_id: string;
    service_name: string;
    amount: number;
    billing_cycle: string;
    due_day: number | null;
    category: string;
    active: boolean;
    url?: string;
}

export interface FinancialProject {
    id?: string;
    user_id: string;
    name: string;
    description?: string;
    goal_amount: number;
    current_amount: number;
    monthly_contribution: number;
    deadline?: string;
    category: string;
    active: boolean;
}

// ══════════════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════════════

export async function getProfile(userId: string): Promise<FinancialProfile | null> {
    const { data, error } = await getClient()
        .from("financial_profile")
        .select("*")
        .eq("user_id", userId)
        .single();
    if (error && error.code !== "PGRST116") console.error("❌ getProfile:", error.message);
    return data;
}

export async function upsertProfile(userId: string, fields: Partial<FinancialProfile>): Promise<void> {
    const { error } = await getClient()
        .from("financial_profile")
        .upsert(
            { user_id: userId, ...fields, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
        );
    if (error) console.error("❌ upsertProfile:", error.message);
}

// ══════════════════════════════════════════════════════════════════════
// ONE-TIME EXPENSES
// ══════════════════════════════════════════════════════════════════════

export async function addOneTimeExpense(expense: Omit<OneTimeExpense, "id">): Promise<OneTimeExpense | null> {
    const { data, error } = await getClient()
        .from("expenses_one_time")
        .insert(expense)
        .select()
        .single();
    if (error) console.error("❌ addOneTimeExpense:", error.message);
    return data;
}

export async function getMonthExpenses(userId: string, year: number, month: number): Promise<OneTimeExpense[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const { data, error } = await getClient()
        .from("expenses_one_time")
        .select("*")
        .eq("user_id", userId)
        .gte("date", startDate)
        .lt("date", endDate)
        .order("date", { ascending: false });
    if (error) console.error("❌ getMonthExpenses:", error.message);
    return data ?? [];
}

// ══════════════════════════════════════════════════════════════════════
// RECURRING FIXED
// ══════════════════════════════════════════════════════════════════════

export async function addRecurringFixed(expense: Omit<RecurringFixed, "id" | "active">): Promise<RecurringFixed | null> {
    const { data, error } = await getClient()
        .from("expenses_recurring_fixed")
        .insert(expense)
        .select()
        .single();
    if (error) console.error("❌ addRecurringFixed:", error.message);
    return data;
}

export async function listRecurringFixed(userId: string): Promise<RecurringFixed[]> {
    const { data, error } = await getClient()
        .from("expenses_recurring_fixed")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("due_day");
    if (error) console.error("❌ listRecurringFixed:", error.message);
    return data ?? [];
}

export async function removeRecurringFixed(userId: string, id: string): Promise<boolean> {
    const { error } = await getClient()
        .from("expenses_recurring_fixed")
        .update({ active: false })
        .eq("id", id)
        .eq("user_id", userId);
    if (error) { console.error("❌ removeRecurringFixed:", error.message); return false; }
    return true;
}

// ══════════════════════════════════════════════════════════════════════
// RECURRING VARIABLE
// ══════════════════════════════════════════════════════════════════════

export async function addRecurringVariable(expense: Omit<RecurringVariable, "id" | "active">): Promise<RecurringVariable | null> {
    const { data, error } = await getClient()
        .from("expenses_recurring_variable")
        .insert(expense)
        .select()
        .single();
    if (error) console.error("❌ addRecurringVariable:", error.message);
    return data;
}

export async function listRecurringVariable(userId: string): Promise<RecurringVariable[]> {
    const { data, error } = await getClient()
        .from("expenses_recurring_variable")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("due_day");
    if (error) console.error("❌ listRecurringVariable:", error.message);
    return data ?? [];
}

export async function addVariableEntry(
    userId: string, recurringId: string, amount: number, referenceMonth: string
): Promise<void> {
    const { error } = await getClient()
        .from("expenses_variable_entries")
        .insert({
            recurring_variable_id: recurringId,
            user_id: userId,
            amount,
            reference_month: referenceMonth,
        });
    if (error) console.error("❌ addVariableEntry:", error.message);
}

// ══════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ══════════════════════════════════════════════════════════════════════

export async function addSubscription(sub: Omit<Subscription, "id" | "active">): Promise<Subscription | null> {
    const { data, error } = await getClient()
        .from("subscriptions")
        .insert(sub)
        .select()
        .single();
    if (error) console.error("❌ addSubscription:", error.message);
    return data;
}

export async function listSubscriptions(userId: string): Promise<Subscription[]> {
    const { data, error } = await getClient()
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("service_name");
    if (error) console.error("❌ listSubscriptions:", error.message);
    return data ?? [];
}

export async function cancelSubscription(userId: string, id: string): Promise<boolean> {
    const { error } = await getClient()
        .from("subscriptions")
        .update({ active: false })
        .eq("id", id)
        .eq("user_id", userId);
    if (error) { console.error("❌ cancelSubscription:", error.message); return false; }
    return true;
}

// ══════════════════════════════════════════════════════════════════════
// FINANCIAL PROJECTS
// ══════════════════════════════════════════════════════════════════════

export async function createProject(project: Omit<FinancialProject, "id" | "active" | "current_amount">): Promise<FinancialProject | null> {
    const { data, error } = await getClient()
        .from("financial_projects")
        .insert(project)
        .select()
        .single();
    if (error) console.error("❌ createProject:", error.message);
    return data;
}

export async function listProjects(userId: string): Promise<FinancialProject[]> {
    const { data, error } = await getClient()
        .from("financial_projects")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("created_at");
    if (error) console.error("❌ listProjects:", error.message);
    return data ?? [];
}

export async function getProjectDetails(userId: string, id: string): Promise<FinancialProject | null> {
    const { data, error } = await getClient()
        .from("financial_projects")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .single();
    if (error) console.error("❌ getProjectDetails:", error.message);
    return data;
}

export async function addContribution(
    userId: string, projectId: string, amount: number, note?: string
): Promise<boolean> {
    const sb = getClient();

    // 1. Insert contribution record
    const { error: insertErr } = await sb
        .from("project_contributions")
        .insert({ project_id: projectId, user_id: userId, amount, note });
    if (insertErr) { console.error("❌ addContribution insert:", insertErr.message); return false; }

    // 2. Update project current_amount
    const { data: project } = await sb
        .from("financial_projects")
        .select("current_amount")
        .eq("id", projectId)
        .single();

    if (project) {
        await sb
            .from("financial_projects")
            .update({
                current_amount: Number(project.current_amount) + amount,
                updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);
    }

    return true;
}

// ══════════════════════════════════════════════════════════════════════
// ALERTS
// ══════════════════════════════════════════════════════════════════════

export async function createAlert(
    userId: string, type: string, message: string, scheduledFor?: string
): Promise<void> {
    const { error } = await getClient()
        .from("financial_alerts")
        .insert({ user_id: userId, type, message, scheduled_for: scheduledFor });
    if (error) console.error("❌ createAlert:", error.message);
}

export async function getPendingAlerts(userId: string): Promise<any[]> {
    const { data, error } = await getClient()
        .from("financial_alerts")
        .select("*")
        .eq("user_id", userId)
        .eq("sent", false)
        .lte("scheduled_for", new Date().toISOString())
        .order("scheduled_for");
    if (error) console.error("❌ getPendingAlerts:", error.message);
    return data ?? [];
}

export async function markAlertSent(id: string): Promise<void> {
    const { error } = await getClient()
        .from("financial_alerts")
        .update({ sent: true })
        .eq("id", id);
    if (error) console.error("❌ markAlertSent:", error.message);
}
