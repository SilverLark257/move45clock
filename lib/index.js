/**
 * DSH 健康钟插件 —— 宿主半边（Host half）
 * ============================================================================
 *
 * 这一半**刻意什么都不做**：健康钟的全部功能（计时、弹窗、声音）都在浏览器
 * 那一半（lib/client.js）里，宿主只需要「存在」，让 bundle patch 能把
 * 插件挂进 profile。
 *
 * 为什么计时不放在宿主里：见 DECISIONS.md 的 ADR-003 —— 弹窗本来就画在
 * 网页上，前端计时最短路径、最好调试；「关窗也计时」留作以后的升级（TBD-1）。
 */

/** 插件名，与 package.json 的 name 一致。 */
export const name = 'dsh-clock';

/**
 * 宿主入口。没有路由、没有服务要注册，只留一行日志证明加载成功。
 * @param ctx - 宿主 cordis 上下文
 */
export function apply(ctx) {
  ctx.logger?.info?.(`[${name}] 宿主半边已加载（功能都在浏览器半边）`);
}
