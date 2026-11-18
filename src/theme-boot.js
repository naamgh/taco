  // Apply the saved theme before anything paints, so there's no flash of the
  // wrong shell on open. Light is the default now; only an explicit 'dark'
  // preference drops the near-black theme.
  try{ if(localStorage.getItem('ftpPlan_theme_v1') !== 'dark') document.documentElement.setAttribute('data-theme', 'light'); }catch(e){ document.documentElement.setAttribute('data-theme', 'light'); }
