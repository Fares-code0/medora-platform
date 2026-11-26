import { hospitalEndpoints } from '@/api/endpoints/hospitals';

import type { HospitalDetail, HospitalPage, HospitalService, HospitalSummary } from './model/types';

/**
 * The HTTP adapter for hospital discovery — `GET /patient/hospitals`
 * and `/patient/hospitals/{id}`. `hasMore` is the server's own
 * `page < totalPages`, never the length of the page.
 */
export const httpHospitalService: HospitalService = {
  async list(params): Promise<HospitalPage> {
    const response = await hospitalEndpoints.list({ q: params.q, page: params.page ?? 1 });
    const { items, totalItems, totalPages, page } = response.data;
    return {
      items: items.map<HospitalSummary>((item) => ({ ...item })),
      totalItems,
      hasMore: page < totalPages,
    };
  },

  async getById(id): Promise<HospitalDetail> {
    const response = await hospitalEndpoints.byId(id);
    return response.data;
  },
};
