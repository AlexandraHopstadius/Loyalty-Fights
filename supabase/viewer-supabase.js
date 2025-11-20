// Minimal viewer wiring for Supabase. Replace existing /state fetch with this.
// Usage:
//   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
//   await loadInitialState(supabase);
//   subscribeRealtime(supabase);

async function loadInitialState(supabase){
  // fetch fights and state row
  const { data: fights } = await supabase.from('fights').select('*').order('ord', { ascending: true });
  const { data: meta } = await supabase.from('metadata').select('value').eq('key','state').limit(1).single().maybeSingle();
  // map fights into the same shape used by fightcard.js
  if (Array.isArray(fights)) window._fights = fights.map(f=>({ id: f.id, a: f.a, b: f.b, weight: f.weight, klass: f.klass, winner: f.winner }));
  if (meta && meta.value){
    const st = meta.value; window.current = (typeof st.current === 'number') ? st.current : 0; window.standby = !!st.standby; window.infoVisible = (typeof st.infoVisible === 'boolean') ? st.infoVisible : true;
  }
  // ask the page to re-render if your fightcard code exposes a function
  if (typeof renderList === 'function') renderList();
  if (typeof updateNow === 'function') updateNow();
}

function subscribeRealtime(supabase){
  // subscribe to fights changes
  const channel = supabase.channel('public:fights')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fights' }, payload => {
      // payload.record contains the new row for INSERT/UPDATE
      console.log('fights change', payload);
      // reload all fights (simple approach)
      loadInitialState(supabase);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'metadata' }, payload => {
      console.log('metadata change', payload);
      loadInitialState(supabase);
    })
    .subscribe();
  return channel;
}

// Example createClient import (in your HTML add the supabase-js script and then):
// const supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// await loadInitialState(supabase); subscribeRealtime(supabase);
