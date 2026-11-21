/**
 * Staff workspaces — PUBLIC API (DEC-006a, FRONTEND_ARCHITECTURE.md §3.4).
 *
 * Reception, Laboratory and Pharmacy. This feature owns only what is new to
 * them — the role homes and the masked directory. The screens they share with
 * other areas (appointment oversight, the lab catalogue, the Settings Center)
 * stay in the features that own them and are composed into these workspaces
 * by the app layer, the one place allowed to import more than one feature.
 */
export { StaffHomePage, type StaffRole } from './home/StaffHomePage';
export { MaskedDirectoryPage } from './directory/MaskedDirectoryPage';
