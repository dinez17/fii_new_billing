# User management

Tenant administrators can edit a staff user's display name and login email in Users → Edit, activate/deactivate with the lock icon, or permanently remove the login account with the delete icon. Deletion requires confirmation and retains historical audit events and business records. Deactivation is reversible. Password resets do not reactivate inactive accounts.

The existing `PUT /api/v1/users/:id` accepts name, email and status with `user:update`. `DELETE /api/v1/users/:id` requires `user:delete`. Both scope targets to staff accounts in the actor's tenant. An administrator cannot disable/delete their own account or change their own roles. Duplicate login emails within a tenant are rejected.

Deactivation revokes refresh sessions and removes outstanding account tokens. Shared authentication checks the current active account and tenant on every authenticated request, so already issued access tokens cannot continue accessing the application after deactivation or deletion. Email/password changes also revoke refresh sessions and pending account tokens; changed email addresses lose their previous verification status.

This change requires deploying the backend services (shared authentication package) and tenant web application. It requires no database migration.
