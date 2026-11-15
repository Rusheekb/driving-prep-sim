import './ui/styles/index.css';
import { type ScreenTable, createApp } from './app/app';
import { progressScreen, quizScreen, resultsScreen, rulesScreen, signsScreen, theoryScreen } from './ui/screens/learn';
import { briefingScreen, homeScreen, regionScreen, scenariosScreen, welcomeScreen } from './ui/screens/menu';
import { aboutScreen, controlsScreen, settingsScreen } from './ui/screens/system';

const screens: ScreenTable = {
  home: homeScreen,
  welcome: welcomeScreen,
  region: regionScreen,
  scenarios: scenariosScreen,
  briefing: briefingScreen,
  settings: settingsScreen,
  controls: controlsScreen,
  about: aboutScreen,
  results: resultsScreen,
  progress: progressScreen,
  rules: rulesScreen,
  signs: signsScreen,
  theory: theoryScreen,
  quiz: quizScreen,
};

createApp(document.getElementById('app')!, screens);
