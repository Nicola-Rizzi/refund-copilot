// THIS FILE IS AUTO-GENERATED. Run `node scripts/generate-stories.js` to regenerate.
// Manual edits will be overwritten.

import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@refund-copilot/ui/button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "outline", "ghost", "destructive", "accent"] },
    size: { control: "select", options: ["sm", "md", "lg", "icon"] },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = { args: { variant: "default", children: "Button" } };
export const Outline: Story = { args: { variant: "outline", children: "Button" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Button" } };
export const Destructive: Story = { args: { variant: "destructive", children: "Delete" } };
export const Accent: Story = { args: { variant: "accent", children: "Highlight" } };
export const Sm: Story = { args: { size: "sm", variant: "default", children: "Button" } };
export const Md: Story = { args: { size: "md", variant: "default", children: "Button" } };
export const Lg: Story = { args: { size: "lg", variant: "default", children: "Button" } };
