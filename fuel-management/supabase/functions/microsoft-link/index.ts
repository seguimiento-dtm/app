import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleLink } from './handler.ts';
import type { Db } from '../_shared/http.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }) as unknown as Db;

Deno.serve((req) => handleLink(req, { db, fetch, env: Deno.env.toObject() }));
