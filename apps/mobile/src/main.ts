import { createApp } from 'vue'
import App from './App.vue'
import LaunchScreen from './components/LaunchScreen.vue'
import './style.css'
createApp(App).mount('#app')

// Start device reconnection while the one-shot launch presentation plays.
const appRoot = document.getElementById('app')!
const launchRoot = document.createElement('div')
appRoot.inert = true
document.body.append(launchRoot)
const launchApp = createApp(LaunchScreen, {
  onFinish: () => {
    appRoot.inert = false
    launchApp.unmount()
    launchRoot.remove()
  },
})
launchApp.mount(launchRoot)
