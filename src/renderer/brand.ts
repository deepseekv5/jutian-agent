/**
 * 应用品牌常量 —— 单一来源
 * 改名时只需修改此处（以及 electron/ 下的主进程与 HTML 入口）
 */
export const APP_NAME = '巨天agent'
export const APP_NAME_EN = 'Jutian Agent'
export const APP_TAGLINE = 'AI 工作台'
import pkg from '../../package.json'

/** 版本号唯一来源:package.json。改版本只需改 package.json,全 App 自动同步 */
export const APP_VERSION = pkg.version
/** 对话中展示的助手称呼 */
export const ASSISTANT_NAME = '巨天'
