import type { TourDefinition } from '../../types/onboarding'

export const usersTour: TourDefinition = {
  id: 'usersTour',
  pageId: 'users',
  title: 'Team Members Tour',
  description: 'Learn how to manage team members and their access levels.',
  steps: [
    {
      id: 'users-header',
      target: '[data-tour="page-header"]',
      title: 'Team Members',
      content:
        'Manage who has access to your organisation\'s finances. Each member has a role that controls what they can view or edit.',
      placement: 'bottom',
    },
    {
      id: 'users-roles',
      target: '[data-tour="role-info"]',
      title: 'Roles Explained',
      content:
        'Owner and Admin can manage team members and all data. Accountant can import and edit transactions. Viewer has read-only access.',
      placement: 'bottom',
    },
    {
      id: 'users-invite',
      target: '[data-tour="invite-button"]',
      title: 'Inviting Members',
      content:
        'Click Invite to send an email invitation. The invitee receives a secure link to create their account and join your organisation.',
      placement: 'left',
    },
  ],
}
