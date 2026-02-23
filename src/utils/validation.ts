/**
 * Simple JSON Schema validator for tool arguments.
 * Ensures the LLM doesn't hallucinate non-existent fields or wrong types.
 */
export function validateToolArgs(schema: any, args: any): { valid: boolean; error?: string } {
    if (schema.type === "object") {
        if (typeof args !== "object" || args === null) {
            return { valid: false, error: "Expected an object for tool arguments." };
        }

        const properties = schema.properties || {};
        const required = schema.required || [];

        // Check required fields
        for (const key of required) {
            if (!(key in args)) {
                return { valid: false, error: `Missing required field: "${key}"` };
            }
        }

        // Check types for provided fields
        for (const [key, value] of Object.entries(args)) {
            const propSchema = properties[key];
            if (!propSchema) {
                return { valid: false, error: `Unauthorized field: "${key}". The tool does not accept this parameter.` };
            }

            const expectedType = propSchema.type;
            const actualType = typeof value;

            if (expectedType === "number" && actualType !== "number") {
                return { valid: false, error: `Invalid type for "${key}": expected number, got ${actualType}.` };
            }
            if (expectedType === "string" && actualType !== "string") {
                return { valid: false, error: `Invalid type for "${key}": expected string, got ${actualType}.` };
            }
            if (expectedType === "boolean" && actualType !== "boolean") {
                return { valid: false, error: `Invalid type for "${key}": expected boolean, got ${actualType}.` };
            }
            // Add array/object check if needed, but keeping it simple for now
        }
    }

    return { valid: true };
}
