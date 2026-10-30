import { App as AntdApp, message as fallbackMessage, Modal as FallbackModal } from 'antd';

type AppApi = ReturnType<typeof AntdApp.useApp>;
let current: AppApi | null = null;
export function bindFeedback(api: AppApi) {
  current = api;
  return () => { if (current === api) current = null; };
}
// Hooks and services can share the same themed notification context without static roots.
export const message = new Proxy(fallbackMessage || {}, {
  get(target, key) {
    const source = current?.message && key in current.message ? current.message : target;
    const value = Reflect.get(source, key);
    return typeof value === 'function' ? value.bind(source) : value;
  },
});
export const modal = new Proxy(FallbackModal || {}, {
  get(target, key) {
    const source = current?.modal && key in current.modal ? current.modal : target;
    const value = Reflect.get(source, key);
    return typeof value === 'function' ? value.bind(source) : value;
  },
});
