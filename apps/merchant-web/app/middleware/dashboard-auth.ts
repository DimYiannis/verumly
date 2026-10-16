export default defineNuxtRouteMiddleware(async () => {
  const s = await refreshSession();
  if (s.state !== 'ready') return navigateTo('/dashboard/login');
});
