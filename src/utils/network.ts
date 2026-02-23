/**
 * Simple exponential backoff retry utility
 */
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

            if (onRetry) {
                onRetry(error, i + 1);
            } else {
                console.warn(`⚠️ Operation failed (attempt ${i + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= factor;
        }
    }

    throw lastError;
}
