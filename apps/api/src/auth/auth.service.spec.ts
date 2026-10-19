import { AuthService } from './auth.service';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');

describe('AuthService.login — e-mail normalization', () => {
  let prisma: any;
  let jwt: any;
  let sessions: any;
  let service: AuthService;

  const baseUser = {
    id: 'u1',
    email: 'nurse@example.com',
    passwordHash: 'hash',
    fullName: 'Nurse One',
    role: 'nurse',
    active: true,
    failedLoginCount: 0,
    lockedUntil: null as Date | null,
    mustChangePassword: false,
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    sessions = { create: jest.fn().mockResolvedValue({ sessionId: 's1', refreshToken: 'refresh-token' }) };
    service = new AuthService(prisma, jwt, sessions);
    (bcrypt.compare as jest.Mock).mockReset();
  });

  it('looks up the account case-insensitively and with whitespace trimmed (a new user typing "John.Doe@..." for an account stored as "john.doe@...")', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.user.update.mockResolvedValue({});

    const result = await service.login('  Nurse@Example.com  ', 'correct');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'nurse@example.com' } });
    expect(result.access_token).toBe('signed.jwt.token');
    expect(result.user.email).toBe(baseUser.email);
  });

  it('still rejects an unknown account (and does not skip the dummy-hash comparison)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.login('Nobody@Example.com', 'whatever')).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'nobody@example.com' } });
    expect(bcrypt.compare).toHaveBeenCalledWith('whatever', expect.any(String));
  });
});
