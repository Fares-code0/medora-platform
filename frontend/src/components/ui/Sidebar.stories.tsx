import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Calendar, FlaskConical, LayoutDashboard, MessageSquare, Users } from 'lucide-react';

import { Sidebar, SidebarItem, SidebarSection } from './Sidebar';

/**
 * The navigation rail primitive: sections, an active item, badge counts,
 * a disabled item, and the collapsed icon rail (every link keeps its name).
 */
function Nav({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="h-[420px]">
      <Sidebar collapsed={collapsed} aria-label="Main navigation">
        <SidebarSection>
          <SidebarItem icon={LayoutDashboard} label="Overview" href="#overview" active />
          <SidebarItem icon={Users} label="Patients" href="#patients" />
          <SidebarItem icon={Calendar} label="Appointments" href="#appointments" />
        </SidebarSection>
        <SidebarSection label="Inbox">
          <SidebarItem icon={MessageSquare} label="Messages" href="#messages" badgeCount={4} />
          <SidebarItem icon={Bell} label="Notifications" href="#notifications" badgeCount={1} />
          <SidebarItem icon={FlaskConical} label="Labs (unavailable)" disabled />
        </SidebarSection>
      </Sidebar>
    </div>
  );
}

const meta = {
  title: 'UI/Sidebar',
  component: Sidebar,
  args: { children: null },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = { render: () => <Nav collapsed={false} /> };
export const Collapsed: Story = { name: 'Collapsed icon rail', render: () => <Nav collapsed /> };
