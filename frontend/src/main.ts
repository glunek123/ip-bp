import { createApp } from 'vue';
import App from './app/App.vue';
import { router } from './app/router';
import { pinia } from './app/pinia';
import { onUnauthorized } from './api/http';
import { useAuthStore } from './stores/auth';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/checkbox/style/css';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/drawer/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/select/style/css';
import './styles/global.css';
import './styles/case-workspace.css';
import './styles/operations.css';

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
