import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LoginPage from '../LoginPage';

// Mock useTranslation
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('LoginPage', () => {
  const mockOnLogin = vi.fn();
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('csrf')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it('renders login form', () => {
    render(<LoginPage onLogin={mockOnLogin} onNavigate={mockOnNavigate} />);
    expect(screen.getByLabelText('login.username_or_email')).toBeInTheDocument();
    expect(screen.getByLabelText('login.password_label')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'login.sign_in' })).toBeInTheDocument();
  });

  it('handles user input', () => {
    render(<LoginPage onLogin={mockOnLogin} onNavigate={mockOnNavigate} />);
    
    const emailInput = screen.getByLabelText('login.username_or_email');
    const passwordInput = screen.getByLabelText('login.password_label');

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });

    expect(emailInput).toHaveValue('test@example.com');
    expect(passwordInput).toHaveValue('password123');
  });

  it('submits form and calls API', async () => {
    const mockUser = { id: 1, username: 'testuser' };
    const mockResponse = { success: true, user: mockUser, token: 'fake-token' };
    
    (global.fetch as any).mockImplementation((url: any) => {
        if (url.toString().includes('csrf')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.toString().includes('login')) {
            return Promise.resolve({ 
                ok: true, 
                json: () => Promise.resolve(mockResponse) 
            });
        }
        return Promise.resolve({ ok: false });
    });

    render(<LoginPage onLogin={mockOnLogin} onNavigate={mockOnNavigate} />);
    
    fireEvent.change(screen.getByLabelText('login.username_or_email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('login.password_label'), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: 'login.sign_in' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login/', expect.anything());
      expect(mockOnLogin).toHaveBeenCalledWith(mockUser);
    });
  });
});
