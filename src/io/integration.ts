import type { Project } from '../core/model/types';
import type { TechPackOptions } from './techPack';
import { buildTechPackData } from './techPack';

/** Cross-tool delivery bundle for a PLM / ERP import. */
export interface PlmPackage {
  format: 'opencloth-plm';
  version: 1;
  exportedAt: string;
  style: {
    name: string;
    date: string;
    baseSize: string | null;
    activeSize: string | null;
  };
  sizes: ReturnType<typeof buildTechPackData>['sizes'];
  panels: ReturnType<typeof buildTechPackData>['panels'];
  fabrics: ReturnType<typeof buildTechPackData>['fabrics'];
  seams: ReturnType<typeof buildTechPackData>['seams'];
  bom: ReturnType<typeof buildTechPackData>['bom'];
  pom: ReturnType<typeof buildTechPackData>['pom'];
  marker: ReturnType<typeof buildTechPackData>['marker'];
}

/** Builds the PLM package from the same data the tech pack prints. */
export function buildPlmPackage(project: Project, options: TechPackOptions = {}): PlmPackage {
  const data = buildTechPackData(project, options);
  return {
    format: 'opencloth-plm',
    version: 1,
    exportedAt: new Date().toISOString(),
    style: {
      name: data.projectName,
      date: data.date,
      baseSize: data.baseSizeLabel,
      activeSize: data.activeSizeLabel,
    },
    sizes: data.sizes,
    panels: data.panels,
    fabrics: data.fabrics,
    seams: data.seams,
    bom: data.bom,
    pom: data.pom,
    marker: data.marker,
  };
}

/** Compact event sent to a webhook endpoint. */
export interface WebhookPayload {
  format: 'opencloth-webhook';
  version: 1;
  event: 'project.updated';
  exportedAt: string;
  project: {
    name: string;
    modifiedAt: string;
  };
  summary: {
    panels: number;
    seams: number;
    fabrics: number;
    sizes: number;
  };
}

/** Builds the payload posted by the 外部对接 dialog. */
export function buildWebhookPayload(project: Project): WebhookPayload {
  return {
    format: 'opencloth-webhook',
    version: 1,
    event: 'project.updated',
    exportedAt: new Date().toISOString(),
    project: {
      name: project.meta.name,
      modifiedAt: project.meta.modifiedAt ?? '',
    },
    summary: {
      panels: Object.keys(project.pattern.panels).length,
      seams: Object.keys(project.pattern.seams).length,
      fabrics: Object.keys(project.fabrics).length,
      sizes: (project.sizes ?? []).length,
    },
  };
}

/** Result of one webhook attempt; failures carry the HTTP status or transport message. */
export interface WebhookResult {
  ok: boolean;
  status: number | null;
  message: string;
}

/** POSTs the payload to a configured endpoint; CORS and network errors come back as failures. */
export async function postWebhook(
  endpoint: string, payload: WebhookPayload, token = '',
): Promise<WebhookResult> {
  const url = endpoint.trim();
  if (!url) return { ok: false, status: null, message: '请先填写 Webhook 地址' };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? `已发送（HTTP ${response.status}）` : `端点返回 HTTP ${response.status}`,
    };
  } catch (err) {
    return { ok: false, status: null, message: `发送失败：${(err as Error).message}` };
  }
}
