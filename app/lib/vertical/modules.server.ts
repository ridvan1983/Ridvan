import type { NormalizedIndustry } from './taxonomy.server';

export interface VerticalModuleSuggestion {
  module_key: string;
  label: string;
  description: string;
  why_now: string;
  geo_notes?: string;
}

export function getModulesForIndustry(industry: NormalizedIndustry, geoCountryCode: string | null) {
  const base: Record<NormalizedIndustry, VerticalModuleSuggestion[]> = {
    hair_salon: [
      {
        module_key: 'booking_system',
        label: 'Booking system',
        description: 'Let customers book time slots and reduce back-and-forth.',
        why_now: 'If you have traffic but no bookings, you need a clear booking path first.',
      },
      {
        module_key: 'service_catalog',
        label: 'Service catalog',
        description: 'Clear services, duration, and pricing ranges so customers can choose quickly.',
        why_now: 'Confusion kills booking intent. Make the choice obvious.',
      },
      {
        module_key: 'staff_selection',
        label: 'Staff selection',
        description: 'Let customers pick a stylist or choose “first available”.',
        why_now: 'Returning customers often care more about the person than the slot.',
      },
      {
        module_key: 'sms_reminders',
        label: 'SMS reminders',
        description: 'Reduce no-shows with automatic reminders.',
        why_now: 'No-shows silently kill revenue; reminders are an easy lever.',
      },
      {
        module_key: 'deposit_policy',
        label: 'Deposits / no-show policy',
        description: 'Optional deposits to protect capacity for high-demand slots.',
        why_now: 'If no-shows are real, deposits reduce risk immediately.',
      },
      {
        module_key: 'staff_schedule',
        label: 'Staff schedule',
        description: 'Avoid double-bookings and keep capacity accurate.',
        why_now: 'Capacity clarity is the difference between growth and chaos.',
      },
      {
        module_key: 'customer_profiles',
        label: 'Customer profiles',
        description: 'Notes, preferences, and visit history.',
        why_now: 'Retention is where salons win. Memory creates loyalty.',
      },
    ],
    restaurant: [
      {
        module_key: 'table_booking',
        label: 'Table booking',
        description: 'Let guests reserve and reduce phone load.',
        why_now: 'Bookings are the revenue gate; remove friction first.',
      },
      {
        module_key: 'capacity_rules',
        label: 'Capacity & turn-time rules',
        description: 'Seating rules, table combinations, and expected turn time.',
        why_now: 'Bad capacity logic creates empty tables or angry guests.',
      },
      {
        module_key: 'waitlist',
        label: 'Waitlist',
        description: 'Capture demand when you’re full and fill cancellations fast.',
        why_now: 'Waitlists turn “no” into revenue.',
      },
      {
        module_key: 'digital_menu',
        label: 'Digital menu',
        description: 'Fast updates, better upsell, easier sharing.',
        why_now: 'Clear menu reduces decision friction and improves conversion.',
      },
      {
        module_key: 'allergen_info',
        label: 'Allergen & dietary info',
        description: 'Make dietary constraints explicit per dish.',
        why_now: 'Reduces risk and increases trust (and fewer staff interruptions).',
      },
      {
        module_key: 'pickup_ordering',
        label: 'Pickup ordering',
        description: 'Simple ordering flow for take-away.',
        why_now: 'If demand exists, pickup is a clean revenue driver with low complexity.',
      },
    ],
    gym: [
      {
        module_key: 'class_booking',
        label: 'Class booking',
        description: 'Booking for classes/PT sessions with capacity limits.',
        why_now: 'Capacity + scheduling is the core product for gyms.',
      },
      {
        module_key: 'schedule_calendar',
        label: 'Schedule calendar',
        description: 'A clean weekly view for classes, changes, and cancellations.',
        why_now: 'If the schedule isn’t obvious, attendance drops.',
      },
      {
        module_key: 'membership_management',
        label: 'Membership management',
        description: 'Plans, renewals, and payment status tracking.',
        why_now: 'Recurring revenue needs clean membership tracking.',
      },
      {
        module_key: 'trial_flow',
        label: 'Trial / intro offer flow',
        description: 'A first-time customer path with clear next step.',
        why_now: 'Most gyms leak revenue between “interested” and “member”.',
      },
      {
        module_key: 'attendance_tracking',
        label: 'Attendance tracking',
        description: 'Know which classes drive retention and upsell.',
        why_now: 'Retention is measurable. If you don’t track it, you guess.',
      },
    ],
    law_firm: [
      {
        module_key: 'case_intake',
        label: 'Case intake',
        description: 'Collect structured legal case details before the first call.',
        why_now: 'Good intake protects partner time and improves lead quality.',
      },
      {
        module_key: 'consultation_booking',
        label: 'Consultation booking',
        description: 'Let prospects request an initial consultation with clear scope.',
        why_now: 'Fast response speed often decides who wins the client.',
      },
      {
        module_key: 'document_signing',
        label: 'Document signing',
        description: 'Move agreements and approvals forward digitally.',
        why_now: 'Reducing paperwork delays speeds up matter conversion.',
      },
    ],
    legal_firm: [
      {
        module_key: 'intake_form',
        label: 'Client intake form',
        description: 'Qualify leads before you spend partner time.',
        why_now: 'You want fewer bad leads and faster qualification.',
      },
      {
        module_key: 'appointment_booking',
        label: 'Consultation booking',
        description: 'Let clients request time slots with clear scope.',
        why_now: 'Time is the inventory; protect it.',
      },
      {
        module_key: 'case_triage',
        label: 'Case triage',
        description: 'Route cases by type/urgency to the right person.',
        why_now: 'A slow response window loses high-value cases.',
      },
      {
        module_key: 'document_intake',
        label: 'Document intake',
        description: 'Collect essential docs securely at the start.',
        why_now: 'Missing documents is the #1 cause of delays and write-offs.',
      },
    ],
    hotel: [
      {
        module_key: 'room_catalog',
        label: 'Room catalog',
        description: 'Show room types, prices, and amenities clearly.',
        why_now: 'Guests need confidence before they click into booking.',
      },
      {
        module_key: 'availability_calendar',
        label: 'Availability calendar',
        description: 'Make availability visible for direct booking intent.',
        why_now: 'Without clear availability, guests leave for OTA flows instead.',
      },
      {
        module_key: 'direct_booking_form',
        label: 'Direct booking form',
        description: 'Capture reservation intent directly on your own site.',
        why_now: 'Direct bookings improve margin immediately.',
      },
    ],
    clinic: [
      {
        module_key: 'appointment_booking',
        label: 'Appointment booking',
        description: 'Let patients request or book times without calling.',
        why_now: 'Manual booking slows conversion and adds admin cost.',
      },
      {
        module_key: 'practitioner_profiles',
        label: 'Practitioner profiles',
        description: 'Build trust with credentials, specialties, and experience.',
        why_now: 'Trust is the main conversion lever for care businesses.',
      },
      {
        module_key: 'insurance_info',
        label: 'Insurance & practical info',
        description: 'Clarify pricing, insurance, and patient expectations.',
        why_now: 'Basic uncertainty delays booking decisions.',
      },
    ],
    real_estate: [
      {
        module_key: 'property_listings',
        label: 'Property listings',
        description: 'Display listings with strong photos and structured details.',
        why_now: 'Listings are the main conversion engine for attention.',
      },
      {
        module_key: 'listing_filters',
        label: 'Listing filters',
        description: 'Let buyers narrow options quickly by price, size, and area.',
        why_now: 'Search friction kills listing engagement fast.',
      },
      {
        module_key: 'valuation_form',
        label: 'Valuation form',
        description: 'Capture seller demand directly with a valuation CTA.',
        why_now: 'Valuation leads are often the highest-value conversion point.',
      },
    ],
    bakery: [
      {
        module_key: 'menu_catalog',
        label: 'Menu catalog',
        description: 'Show breads, pastries, cakes, and seasonal items with prices.',
        why_now: 'If the menu is unclear, people ask instead of ordering.',
      },
      {
        module_key: 'custom_order_form',
        label: 'Custom order form',
        description: 'Capture cake and catering orders with details upfront.',
        why_now: 'Custom orders are high-value and should not rely on DMs.',
      },
      {
        module_key: 'pickup_preorder',
        label: 'Pickup pre-ordering',
        description: 'Allow customers to reserve items before they sell out.',
        why_now: 'Pre-orders smooth demand and improve production planning.',
      },
    ],
    beauty: [
      {
        module_key: 'booking_calendar',
        label: 'Booking calendar',
        description: 'Turn treatment interest into confirmed appointments.',
        why_now: 'Manual booking wastes conversion from social and search traffic.',
      },
      {
        module_key: 'before_after_gallery',
        label: 'Before / after gallery',
        description: 'Use proof to increase trust for premium treatments.',
        why_now: 'Beauty buyers often convert only after they see clear proof.',
      },
      {
        module_key: 'price_list',
        label: 'Price list',
        description: 'Clarify treatments, duration, and pricing in one place.',
        why_now: 'Pricing ambiguity slows down bookings.',
      },
    ],
    e_commerce: [
      {
        module_key: 'product_catalog',
        label: 'Product catalog',
        description: 'Show products, variants, and merchandising clearly.',
        why_now: 'Customers need confidence before they add to cart.',
      },
      {
        module_key: 'checkout',
        label: 'Checkout',
        description: 'Turn buying intent into paid orders with low friction.',
        why_now: 'Checkout quality is the main revenue lever in commerce.',
      },
      {
        module_key: 'inventory',
        label: 'Inventory',
        description: 'Keep availability accurate across products and variants.',
        why_now: 'Stock errors create support load and trust loss.',
      },
    ],
    ecommerce: [
      {
        module_key: 'checkout',
        label: 'Checkout',
        description: 'A frictionless checkout with payment and order confirmation.',
        why_now: 'Revenue happens at checkout; everything else is secondary.',
      },
      {
        module_key: 'order_tracking',
        label: 'Order tracking',
        description: 'Reduce support load with clear delivery status.',
        why_now: 'Support cost is a hidden margin killer.',
      },
    ],
    food_delivery: [
      {
        module_key: 'order_management',
        label: 'Order management',
        description: 'Receive, route, and complete delivery orders efficiently.',
        why_now: 'Operational clarity is the core of delivery margin.',
      },
      {
        module_key: 'realtime_tracking',
        label: 'Realtime tracking',
        description: 'Show delivery progress to customers and reduce support tickets.',
        why_now: 'Delivery uncertainty creates churn and support cost.',
      },
      {
        module_key: 'delivery_zones',
        label: 'Delivery zones',
        description: 'Control where you deliver and what margin each zone supports.',
        why_now: 'Bad zone logic quietly destroys profitability.',
      },
    ],
    education: [
      {
        module_key: 'course_catalog',
        label: 'Course catalog',
        description: 'Make courses, outcomes, and pricing easy to compare.',
        why_now: 'People do not enroll when the offer is unclear.',
      },
      {
        module_key: 'student_portal',
        label: 'Student portal',
        description: 'Give students one place for lessons, updates, and progress.',
        why_now: 'A clear learning experience improves retention.',
      },
      {
        module_key: 'certificates',
        label: 'Certificates',
        description: 'Reward completion with automated certificates.',
        why_now: 'Completion proof increases perceived value and referrals.',
      },
    ],
    auto_repair: [
      {
        module_key: 'service_booking',
        label: 'Service booking',
        description: 'Capture workshop demand with structured service requests.',
        why_now: 'Phone-only booking creates missed demand and admin drag.',
      },
      {
        module_key: 'vehicle_history',
        label: 'Vehicle history',
        description: 'Show service history and recommendations per vehicle.',
        why_now: 'Trust and repeat service come from documented history.',
      },
      {
        module_key: 'parts_order',
        label: 'Parts ordering',
        description: 'Speed up fulfillment by linking parts demand to jobs.',
        why_now: 'Parts delays reduce workshop utilization.',
      },
    ],
    accounting: [
      {
        module_key: 'client_portal',
        label: 'Client portal',
        description: 'Centralize document exchange and client communication.',
        why_now: 'Messy communication wastes billable time.',
      },
      {
        module_key: 'invoice_generator',
        label: 'Invoice generator',
        description: 'Create and send invoices with less manual work.',
        why_now: 'Billing speed improves cash flow immediately.',
      },
      {
        module_key: 'tax_calculator',
        label: 'Tax calculator',
        description: 'Turn tax complexity into a useful client-facing tool.',
        why_now: 'Helpful tools build trust and generate better leads.',
      },
    ],
    event_planning: [
      {
        module_key: 'event_registration',
        label: 'Event registration',
        description: 'Manage signups and attendee data in one flow.',
        why_now: 'Registration clarity is the foundation of event conversion.',
      },
      {
        module_key: 'ticket_sales',
        label: 'Ticket sales',
        description: 'Sell tickets directly with clean confirmation flows.',
        why_now: 'Revenue depends on reducing friction from interest to purchase.',
      },
      {
        module_key: 'seating_plan',
        label: 'Seating plan',
        description: 'Handle placements and guest logistics without chaos.',
        why_now: 'Operational clarity reduces event-day risk.',
      },
    ],
    photography: [
      {
        module_key: 'portfolio_gallery',
        label: 'Portfolio gallery',
        description: 'Present signature work in a premium, conversion-friendly format.',
        why_now: 'Photography buyers decide based on proof and style fit.',
      },
      {
        module_key: 'shoot_booking',
        label: 'Shoot booking',
        description: 'Turn inquiries into booked sessions quickly.',
        why_now: 'A clear booking step reduces lead leakage.',
      },
      {
        module_key: 'photo_delivery',
        label: 'Photo delivery',
        description: 'Deliver galleries digitally with a polished client experience.',
        why_now: 'Delivery quality affects referrals and repeat business.',
      },
    ],
    consultant: [
      {
        module_key: 'service_packages',
        label: 'Service packages',
        description: 'Turn vague consulting into clear offers with scope and price logic.',
        why_now: 'Packaged offers reduce friction and improve lead quality.',
      },
      {
        module_key: 'case_studies',
        label: 'Case studies',
        description: 'Show proof of outcomes with credible examples.',
        why_now: 'Authority drives conversion in consulting.',
      },
      {
        module_key: 'brief_form',
        label: 'Brief form',
        description: 'Qualify opportunities before the first call.',
        why_now: 'Filtering low-fit leads protects billable time.',
      },
    ],
    school: [
      {
        module_key: 'course_catalog',
        label: 'Course catalog',
        description: 'Organize programs, outcomes, and pricing clearly.',
        why_now: 'Course clarity is the first enrollment lever.',
      },
      {
        module_key: 'enrollment_form',
        label: 'Enrollment form',
        description: 'Make it obvious how to apply or reserve a seat.',
        why_now: 'Interest without an enrollment path is wasted demand.',
      },
      {
        module_key: 'instructor_profiles',
        label: 'Instructor profiles',
        description: 'Build credibility with teacher background and expertise.',
        why_now: 'Trust in the instructor often decides the purchase.',
      },
    ],
    saas: [
      {
        module_key: 'onboarding',
        label: 'Onboarding',
        description: 'Make the first 5 minutes obvious and useful.',
        why_now: 'Most churn is decided in the first session.',
      },
      {
        module_key: 'billing',
        label: 'Billing setup',
        description: 'Plans, upgrades, and access control.',
        why_now: 'If you can’t charge cleanly, you can’t learn what sells.',
      },
    ],
    unknown: [],
  };

  const suggestions = base[industry] ?? [];

  if (!geoCountryCode) {
    return suggestions;
  }

  return suggestions.map((s) => {
    if (geoCountryCode === 'SE' && s.module_key.includes('checkout')) {
      return { ...s, geo_notes: 'In Sweden, consider Swish/Klarna early if you sell to consumers.' };
    }

    if (geoCountryCode === 'TR' && s.module_key.includes('checkout')) {
      return { ...s, geo_notes: 'In Turkey, card + cash options are common; iyzico is a common integration.' };
    }

    return s;
  });
}
