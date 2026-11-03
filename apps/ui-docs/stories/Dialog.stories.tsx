// THIS FILE IS AUTO-GENERATED. Run `node scripts/generate-stories.js` to regenerate.
// Manual edits will be overwritten.

import type { Meta, StoryObj } from "@storybook/react";
import { Dialog } from "@refund-copilot/ui/dialog";

const meta: Meta<typeof Dialog> = {
  title: "Components/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
    open: { control: "boolean" },
    onClose: { control: "text" },
    title: { control: "text" },
  },
};
export default meta;
type Story = StoryObj<typeof Dialog>;

export const Sm: Story = { render: () => (
  <Dialog open size="sm" title="Confirm delete" onClose={() => {}}>
    <p>This can't be undone.</p>
  </Dialog>
) };
export const Md: Story = { render: () => (
  <Dialog open size="md" title="Confirm delete" onClose={() => {}}>
    <p>This can't be undone.</p>
  </Dialog>
) };
export const Lg: Story = { render: () => (
  <Dialog open size="lg" title="Confirm delete" onClose={() => {}}>
    <p>This can't be undone.</p>
  </Dialog>
) };
