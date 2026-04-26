import type { Resolver } from 'react-hook-form';
import type { z } from 'zod';

// @hookform/resolvers@4.x uses `error?.errors` to detect ZodError, but Zod 4 removed
// the `.errors` alias (only `.issues` exists). This resolver reads `.issues` directly.
export function zodResolver<T extends Record<string, unknown>>(
  schema: z.ZodSchema<T>,
): Resolver<T> {
  const resolver = async (values: T) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data as T, errors: {} };
    const errors: Record<string, { message: string; type: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join('.');
      if (path && !errors[path]) {
        errors[path] = { message: issue.message, type: issue.code };
      }
    }
    return { values: {} as T, errors };
  };
  // ResolverError<T> requires values: Record<string, never> which conflicts with T extends Record<string, unknown>
  return resolver as unknown as Resolver<T>;
}
