// THIS FILE IS AUTO-GENERATED. Run `node scripts/generate-stories.js` to regenerate.
// Manual edits will be overwritten.

import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "@refund-copilot/ui/input";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "error", "ghost"] },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = { args: { variant: "default" } };
export const Error: Story = { args: { variant: "error" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Sm: Story = { args: { size: "sm", variant: "default" } };
export const Md: Story = { args: { size: "md", variant: "default" } };
export const Lg: Story = { args: { size: "lg", variant: "default" } };
