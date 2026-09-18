import { createApp } from 'vue';
import App from './app/App.vue';
import { router } from './app/router';
import { pinia } from './app/pinia';
import { onUnauthorized } from './api/http';
import { useAuthStore } from './stores/auth';
import 'element-plus/es/components/button/style/css';
import './styles/global.css';

onUnauthorized(() => {
  useAuthStore(pinia).clear();
  if (router.currentRoute.value.path !== '/login') {
    void router.replace({
      path: '/login',
      query: { returnTo: router.currentRoute.value.fullPath },
    });
  }
});

createApp(App).use(pinia).use(router).mount('#app');
