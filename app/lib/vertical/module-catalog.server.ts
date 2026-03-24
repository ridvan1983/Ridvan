export type ModuleCatalogItem = {
  module_key: string;
  industry: string;
  description: string;
  roi_stat: string;
  price_monthly: number;
  activation_prompt_template: string;
};

export const MODULE_CATALOG: ModuleCatalogItem[] = [
  {
    module_key: 'booking_system',
    industry: 'hair_salon',
    description: 'Online booking with services, staff, time slots and confirmations.',
    roi_stat: 'Salons with online booking typically get 20–40% more bookings from the same traffic.',
    price_monthly: 299,
    activation_prompt_template:
      'Add an online booking system to the existing app. Requirements:\n- Service catalog (name, duration, price).\n- Staff selection and availability.\n- Time-slot booking flow with confirmation.\n- Simple admin view to manage bookings.\n- Keep existing design style and language.\nOnly add what is needed; do not rewrite unrelated pages.',
  },
  {
    module_key: 'table_booking',
    industry: 'restaurant',
    description: 'Table reservations with capacity rules, confirmations, and cancellation link.',
    roi_stat: 'Restaurants with self-serve reservations reduce missed calls and improve seat fill rate.',
    price_monthly: 299,
    activation_prompt_template:
      'Add a table reservation system to the existing app. Requirements:\n- Reservation form (date, time, party size, contact).\n- Basic capacity rules and confirmation screen.\n- Admin view to see upcoming reservations.\n- Keep existing design and language.\nOnly add what is needed; do not rewrite unrelated pages.',
  },
  {
    module_key: 'class_booking',
    industry: 'gym',
    description: 'Class schedule + booking with membership-friendly UX.',
    roi_stat: 'Gyms that let members book classes online see higher attendance consistency.',
    price_monthly: 299,
    activation_prompt_template:
      'Add a class schedule and class booking system to the existing app. Requirements:\n- Public schedule view (classes, times, coach).\n- Book a spot flow with confirmation.\n- Admin view to manage classes and see bookings.\n- Keep existing design and language.\nOnly add what is needed; do not rewrite unrelated pages.',
  },
  {
    module_key: 'appointment_booking',
    industry: 'legal_firm',
    description: 'Client appointment booking + intake fields + follow-up confirmation.',
    roi_stat: 'Faster response and clearer intake improves lead-to-consult conversion for firms.',
    price_monthly: 399,
    activation_prompt_template:
      'Add an appointment booking + intake form to the existing app. Requirements:\n- Booking form with time selection and intake questions (case type, urgency, contact).\n- Confirmation page and email placeholder copy (no external integrations yet).\n- Admin view to review requests.\n- Keep existing design and language.\nOnly add what is needed; do not rewrite unrelated pages.',
  },
];

export function pickUpsellModuleForIndustry(industry: string | null) {
  if (!industry) {
    return null;
  }

  const items = MODULE_CATALOG.filter((m) => m.industry === industry);
  return items[0] ?? null;
}
