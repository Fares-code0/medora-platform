/**
 * Doctor → administrator data-error reports (D-07). The patient profile
 * writes, the admin patients area reads, and neither imports the other
 * (§3.3, §3.4).
 */
export {
  __resetDataErrorReports,
  fileDataErrorReport,
  listDataErrorReports,
  openReportsForPatient,
  resolveDataErrorReport,
  type FileDataErrorInput,
} from './store';
export { dataErrorReportKeys, useFileDataErrorReportMutation } from './queries';
export {
  dataErrorReportService,
  mockDataErrorReportService,
  unconnectedDataErrorReportService,
  type DataErrorReportService,
} from './service';
export {
  DATA_ERROR_FIELDS,
  DATA_ERROR_FIELD_LABEL,
  type DataErrorField,
  type DataErrorReport,
} from './types';
