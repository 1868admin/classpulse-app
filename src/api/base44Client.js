import { supabase } from '@/lib/supabase';

const entities = new Proxy({}, {
  get(_target, entity) {
    if (typeof entity !== 'string') return undefined;
    
    return {
      filter: async (query = {}, options = {}) => {
        let req = supabase.from(entity).select('*');
        if (Object.keys(query).length > 0) req = req.match(query);
        const { data, error } = await req;
        if (error) throw error;
        return data;
      },
      get: async (id) => {
        const { data, error } = await supabase.from(entity).select('*').eq('id', id).single();
        if (error) throw error;
        return data;
      },
      create: async (record) => {
        const { data, error } = await supabase.from(entity).insert(record).select().single();
        if (error) throw error;
        return data;
      },
      bulkCreate: async (records) => {
        const { data, error } = await supabase.from(entity).insert(records).select();
        if (error) throw error;
        return data;
      },
      update: async (id, patch) => {
        const { data, error } = await supabase.from(entity).update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      delete: async (id) => {
        const { error } = await supabase.from(entity).delete().eq('id', id);
        if (error) throw error;
        return true;
      }
    };
  },
});

export const base44 = {
  entities,
  auth: {
    loginViaEmailPassword: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw Object.assign(new Error(error.message), { status: error.status || 401 });
      return data.user;
    },
    me: async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
      return user;
    },
    isAuthenticated: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return !!session;
    },
    logout: async (returnTo) => {
      await supabase.auth.signOut();
      if (returnTo) window.location.assign('/login');
    },
    redirectToLogin: (returnTo) => {
      const path = returnTo && new URL(returnTo, window.location.origin).origin === window.location.origin
        ? `${window.location.pathname}${window.location.search}`
        : '/';
      window.location.assign(`/login?returnTo=${encodeURIComponent(path)}`);
    },
  },
};