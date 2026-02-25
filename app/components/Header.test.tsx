import { render, screen } from '@testing-library/react';
import { MemoryRouter } from '@remix-run/react';
import { describe, it, expect, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import Header from './Header';

expect.extend(toHaveNoViolations);

// Mocking Lucide icons to inspect props
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    Search: (props: any) => <svg data-testid="icon-search" {...props} />,
    Menu: (props: any) => <svg data-testid="icon-menu" {...props} />,
  };
});

describe('Header Component - Branding Update 2026', () => {
  const renderHeader = (path = '/') => {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Header />
      </MemoryRouter>
    );
  };

  it('TC-HDR-01: applies the correct brand green background', () => {
    renderHeader();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('bg-brand-green-700');
  });

  it('TC-HDR-02: applies slate-50 color to navigation links', () => {
    renderHeader();
    const link = screen.getByText(/Test List/i);
    expect(link).toHaveClass('text-slate-50');
  });

  it('TC-HDR-03: configures icons with white color and correct dimensions', () => {
    renderHeader();
    const icon = screen.getByTestId('icon-search');
    expect(icon).toHaveClass('text-white');
    expect(icon).toHaveAttribute('stroke-width', '2');
    // Size 20 maps to width/height 20 in lucide-react default mapping
    expect(icon).toHaveAttribute('width', '20');
    expect(icon).toHaveAttribute('height', '20');
  });

  it('TC-NAV-01: applies the darker hover background to links', () => {
    renderHeader();
    const link = screen.getByText(/Test List/i);
    expect(link).toHaveClass('hover:bg-brand-green-800');
  });

  it('TC-NAV-02: applies active styles when the route matches', () => {
    renderHeader('/test-list');
    const activeLink = screen.getByText(/Test List/i);
    // NavLink logic: isActive adds border classes
    expect(activeLink).toHaveClass('border-b-2');
    expect(activeLink).toHaveClass('border-white');
  });

  it('TC-NAV-03: does not apply active styles to inactive routes', () => {
    renderHeader('/admin');
    const inactiveLink = screen.getByText(/Test List/i);
    expect(inactiveLink).not.toHaveClass('border-b-2');
  });

  it('TC-ACC-01: passes WCAG AA accessibility audit', async () => {
    const { container } = renderHeader();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('TC-SSR-01: should have static classes for SSR stability', () => {
    // This ensures classes are present on first render without useEffect
    const { container } = renderHeader();
    const header = container.querySelector('header');
    expect(header?.className).toContain('bg-brand-green-700');
  });
});