// THIS FILE IS AUTO-GENERATED. Run `node scripts/generate-stories.js` to regenerate.
// Manual edits will be overwritten.

import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "@refund-copilot/ui/badge";

const meta: Meta<typeof Badge> = {
  title: "Components/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "outline", "success", "error", "accent", "muted"] },
  },
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { variant: "default", children: "Badge" } };
export const Outline: Story = { args: { variant: "outline", children: "Draft" } };
export const Success: Story = { args: { variant: "success", children: "Done" } };
export const Error: Story = { args: { variant: "error", children: "Failed" } };
export const Accent: Story = { args: { variant: "accent", children: "New" } };
export const Muted: Story = { args: { variant: "muted", children: "Pending" } };
