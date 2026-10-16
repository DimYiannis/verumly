/** Pages that need a session send the visitor through email login and bring them back. */
export default defineNuxtRouteMiddleware((to) => {
  if (!useWallet().session.value) return navigateTo({ path: '/login', query: { next: to.fullPath } });
});
