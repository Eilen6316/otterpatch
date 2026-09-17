/**
 * 首次运行向导的步骤状态机(纯函数,可单测)。
 *
 * provider(选 Provider)→ key(填 Key/模型)→ testing(连接测试)→ done(成功)。
 * 测试失败回到 key 并带上错误文案;任何步骤都可经组件的"稍后再说"退出。
 */

export type SetupStep = 'provider' | 'key' | 'testing' | 'done';

export interface SetupState {
  step: SetupStep;
  error: string | null;
}

export type SetupAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'test-start' }
  | { type: 'test-ok' }
  | { type: 'test-fail'; message: string };

export const initialSetupState: SetupState = { step: 'provider', error: null };

export function reduceSetup(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'next':
      return state.step === 'provider' ? { step: 'key', error: null } : state;
    case 'back':
      return state.step === 'key' ? { step: 'provider', error: null } : state;
    case 'test-start':
      return state.step === 'key' ? { step: 'testing', error: null } : state;
    case 'test-ok':
      return state.step === 'testing' ? { step: 'done', error: null } : state;
    case 'test-fail':
      // 失败回到 key 步骤并保留错误文案,让用户改 Key 重试。
      return state.step === 'testing' ? { step: 'key', error: action.message } : state;
    default:
      return state;
  }
}

/** 测试按钮可用条件:key 非空且当前不在测试中。 */
export function canRunConnectionTest(state: SetupState, apiKey: string): boolean {
  return state.step === 'key' && apiKey.trim().length > 0;
}
