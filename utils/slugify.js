import slugifyLib from 'slugify';

/**
 * Generate URL-friendly slug from text
 * Appends random suffix to ensure uniqueness
 */
export const createSlug = (text, options = {}) => {
  const slug = slugifyLib(text, {
    lower: true,
    strict: true,
    trim: true,
    ...options,
  });
  return slug;
};

/**
 * Generate unique slug by checking against existing slugs in the database
 */
export const createUniqueSlug = async (Model, text, existingId = null) => {
  let slug = createSlug(text);
  let counter = 0;
  let candidateSlug = slug;

  while (true) {
    const query = { slug: candidateSlug };
    if (existingId) {
      query._id = { $ne: existingId };
    }
    const existing = await Model.findOne(query);
    if (!existing) break;
    counter++;
    candidateSlug = `${slug}-${counter}`;
  }

  return candidateSlug;
};
