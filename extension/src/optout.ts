// RFC 2368 opt-out generator. Mail is handed to the user's mail client; the
// extension itself never sends anything.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function generateOptOutMail(companyEmail: string, serviceName: string): string {
  if (!EMAIL_SHAPE.test(companyEmail)) {
    throw new Error(`Refusing to build mailto for malformed address: ${companyEmail}`);
  }

  const subject = encodeURIComponent(`Arbitration Opt-Out Notice - ${serviceName}`);
  const body = encodeURIComponent(
    `To Legal Department,\n\n` +
      `Please accept this formal notification that I hereby reject and opt out of ` +
      `the mandatory arbitration agreement and class action waiver provisions contained in the ` +
      `${serviceName} Terms of Service, as permitted under the governing terms.\n\n` +
      `Account Reference: [Insert your username or email here]\n` +
      `Date: ${new Date().toISOString().split('T')[0]}\n\n` +
      `Regards,\n[Insert Full Legal Name]`,
  );

  return `mailto:${companyEmail}?subject=${subject}&body=${body}`;
}

/** Opt-out windows are usually 30 days; flag them so the UI can warn. */
export function optOutDeadline(registrationDate: Date, windowDays = 30): Date {
  const deadline = new Date(registrationDate);
  deadline.setDate(deadline.getDate() + windowDays);
  return deadline;
}
