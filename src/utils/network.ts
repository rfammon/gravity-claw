/**
 * Simple exponential backoff retry utility
 */

function isRateLimitError(error: any): boolean {
    if (!error) return false;
    const status = error.status || error.statusCode || error.response?.status;
    return status === 429;
}

function getRetryAfterHeader(error: any): number | null {
    const retryAfter = error.response?.headers?.["retry-after"] || 
                       error.response?.headers?.["Retry-After"] ||
                       error.headers?.["retry-after"];
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds;
    }
    return null;
}

export async function withRetry<T>(
    operation: () => Promise<T>,
    options: {
        maxRetries?: number;
        initialDelay?: number;
        factor?: number;
        onRetry?: (error: any, retryCount: number) => void;
    } = {}
): Promise<T> {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        factor = 2,
        onRetry
    } = options;

    let lastError: any;
    let delay = initialDelay;

    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            if (i === maxRetries) break;

            const retryAfter = getRetryAfterHeader(error);
            if (retryAfter) {
                delay = retryAfter * 1000;
                console.warn(`⏳ Rate limited! Waiting ${retryAfter}s before retry...`);
            } else if (isRateLimitError(error)) {
                delay = Math.min(delay * factor * 2, 30000);
                console.warn(`⚠️ Rate limit detected (attempt ${i + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`);
            } else {
                if (onRetry) {
                    onRetry(error, i + 1);
                } else {
                    console.warn(`⚠️ Operation failed (attempt ${i + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`);
                }
                delay *= factor;
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
