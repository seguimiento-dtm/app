// Declaraciones mínimas de Deno para revisar los tipos de las funciones con TypeScript de Node (npm run typecheck:functions).
declare const Deno: {
  env: { get(key: string): string | undefined; toObject(): Record<string, string> };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}
