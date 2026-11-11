import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import 'primeicons/primeicons.css';
import './style.css';
import App from './App.vue';

const theme = definePreset(Aura, {
  semantic: {
    primary: { 50: '#fff8e9', 100: '#f9e8bf', 200: '#f4d49a', 300: '#efc77a', 400: '#e6b85c', 500: '#d8a743', 600: '#b98a31', 700: '#966e27', 800: '#775822', 900: '#60481f', 950: '#35260f' },
    colorScheme: { dark: {
      surface: { 0: '#f0ebde', 50: '#f0ebde', 100: '#e2ddcf', 200: '#d0cbbf', 300: '#a6a397', 400: '#858585', 500: '#575757', 600: '#333333', 700: '#272727', 800: '#202020', 900: '#181818', 950: '#0c0d0c' },
      primary: { color: '#f0ebde', contrastColor: '#0c0d0c', hoverColor: '#ffffff', activeColor: '#f1e6d1' },
    } },
  },
});

createApp(App).use(PrimeVue, { theme: { preset: theme, options: { darkModeSelector: '.app-dark', cssLayer: false } } }).mount('#app');
