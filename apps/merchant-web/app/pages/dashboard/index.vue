<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });
await navigateTo('/dashboard/archive', { replace: true });
</script>
<template><div /></template>
