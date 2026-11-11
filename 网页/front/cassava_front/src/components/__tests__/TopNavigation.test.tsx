import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TopNavigation from '../TopNavigation';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
describe('navigation access', () => {
  it('does not advertise private business pages before login', () => {
    render(<TopNavigation activeSection="home" onSectionChange={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'navigation.images'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'navigation.prediction'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'登录 / 试用'})).toBeInTheDocument();
  });
  it('provides explicit mobile workspace entry points after login', () => {
    render(<TopNavigation activeSection="images" currentUser={{username:'Guest',is_guest:true}} onSectionChange={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'图片'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'预测'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'navigation.prediction'})).toBeInTheDocument();
  });
  it('keeps the login header free of business links', () => {
    render(<TopNavigation activeSection="login" onSectionChange={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'navigation.prediction'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'navigation.contact'})).not.toBeInTheDocument();
  });
});
