import type { Meta, StoryObj } from '@storybook/react-vite';

import { Fact, FactGrid } from './FactList';

/** A semantic `<dl>` of label/value pairs. Long values truncate rather than wrap. */
const meta = {
  title: 'Patterns/FactList',
  component: FactGrid,
  args: {
    children: (
      <>
        <Fact label="Date of birth">12 March 1971</Fact>
        <Fact label="Blood type">O+</Fact>
        <Fact label="Primary doctor">Dr. Amelia Chen</Fact>
        <Fact label="Insurance">National Health · Plan 4</Fact>
      </>
    ),
  },
} satisfies Meta<typeof FactGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoColumns: Story = {};

export const OneColumn: Story = { args: { columns: 1 } };

export const Truncation: Story = {
  render: () => (
    <div className="max-w-xs">
      <FactGrid>
        <Fact label="Address">Building 14, Al-Rabwa Street, Northern District, Amman 11183</Fact>
        <Fact label="Email">a.very.long.email.address@hospital.example.org</Fact>
      </FactGrid>
    </div>
  ),
};

/** A value read whole: `truncate={false}` wraps at its spaces instead of cutting it. */
export const ReadWhole: Story = {
  render: () => (
    <div className="max-w-[16rem]">
      <FactGrid>
        <Fact label="Phone" truncate={false}>
          <span className="font-mono" dir="ltr">
            +20 100 214 3387
          </span>
        </Fact>
        <Fact label="Blood group">
          <span dir="ltr">O+</span>
        </Fact>
      </FactGrid>
    </div>
  ),
};
