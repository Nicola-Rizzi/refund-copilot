// THIS FILE IS AUTO-GENERATED. Run `node scripts/generate-stories.js` to regenerate.
// Manual edits will be overwritten.

import type { Meta, StoryObj } from "@storybook/react";
import { Card, CardHeader, CardTitle, CardContent } from "@refund-copilot/ui/card";

const meta: Meta<typeof Card> = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "elevated", "ghost", "outlined"] },
    padding: { control: "select", options: ["none", "sm", "md", "lg"] },
  },
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = { render: () => (
  <Card variant="default" padding="md">
    <CardHeader><CardTitle>Default</CardTitle></CardHeader>
    <CardContent>Card body content goes here.</CardContent>
  </Card>
) };
export const Elevated: Story = { render: () => (
  <Card variant="elevated" padding="md">
    <CardHeader><CardTitle>Elevated</CardTitle></CardHeader>
    <CardContent>Card body content goes here.</CardContent>
  </Card>
) };
export const Ghost: Story = { render: () => (
  <Card variant="ghost" padding="md">
    <CardHeader><CardTitle>Ghost</CardTitle></CardHeader>
    <CardContent>Card body content goes here.</CardContent>
  </Card>
) };
export const Outlined: Story = { render: () => (
  <Card variant="outlined" padding="md">
    <CardHeader><CardTitle>Outlined</CardTitle></CardHeader>
    <CardContent>Card body content goes here.</CardContent>
  </Card>
) };
