<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue';
import type { SavedDevice } from '../composables/use-remote-control';
defineProps<{ devices: SavedDevice[]; busy: boolean; native: boolean }>();
const address = defineModel<string>('address', { required: true });
const token = defineModel<string>('token', { required: true });
const name = defineModel<string>('name', { required: true });
defineEmits<{ connect: [device?: SavedDevice]; forget: [device: SavedDevice]; edit: [device: SavedDevice] }>();
</script>
<template>
  <h2 v-if="devices.length" class="subheading">已保存的电脑</h2>
  <div v-if="devices.length" class="list-panel device-list">
    <div v-for="device in devices" :key="device.address" class="saved-device">
      <button class="list-row" :disabled="busy" @click="$emit('connect', device)"><span class="icon-disc secondary"><AppIcon name="computer" /></span><span class="row-copy"><strong>{{ device.name }}</strong><small>{{ device.address }}</small></span><AppIcon class="chevron" name="chevron" /></button>
      <div class="output-actions"><button class="text-button remove-device" :disabled="busy" @click="$emit('edit', device)">更新访问令牌</button><button class="text-button remove-device" :disabled="busy" @click="$emit('forget', device)">从本机移除</button></div>
    </div>
  </div>
  <h2 class="subheading">连接电脑</h2>
  <form class="panel form-panel" @submit.prevent="$emit('connect')">
    <label>电脑 IP 或地址<input v-model="address" placeholder="192.168.1.20:8080" required autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" /></label>
    <label>电脑名称<input v-model="name" maxlength="64" required autocomplete="off" /></label>
    <label>访问令牌<input v-model="token" placeholder="电脑端 SANDKASTEN_API_TOKEN" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
    <button class="primary-button full-width" :disabled="busy">{{ busy ? '正在连接…' : '连接并保存' }}</button>
  </form>
  <p class="hint page-note">{{ native ? '访问令牌通过 Android Keystore 加密保存，点击已保存的电脑即可重连。' : '浏览器仅在本次会话保存令牌；安装版支持安全保存。' }}电脑未设置认证时可留空。</p>
</template>
