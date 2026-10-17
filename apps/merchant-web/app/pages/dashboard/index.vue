<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });
await navigateTo('/dashboard/overview', { replace: true });
</script>
<template><div /></template>
