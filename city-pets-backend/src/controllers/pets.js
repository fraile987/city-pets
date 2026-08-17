/* =========================================================
   CITY PETS — Controladores de mascotas
   El propietario de una mascota siempre sale de req.user.id.
   Nunca se acepta userId del cuerpo de la petición.
   ========================================================= */

const prisma = require('../db');
const { MAX } = require('../constants');

/* Número a Float, o NaN si no es numérico. */
function toFloat(v) {
  if (v === undefined || v === null || v === '') return NaN;
  return parseFloat(v);
}

async function listPets(req, res) {
  const pets = await prisma.pet.findMany({ where: { userId: req.user.id } });
  res.json(pets);
}

async function getPet(req, res) {
  const pet = await prisma.pet.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!pet) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }
  res.json(pet);
}

async function createPet(req, res) {
  const { name, species, breed, age, ration, weight } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  if (name.trim().length > MAX.name) {
    return res.status(400).json({ error: `El nombre no puede superar ${MAX.name} caracteres` });
  }
  if (!species || typeof species !== 'string' || !species.trim()) {
    return res.status(400).json({ error: 'La especie es obligatoria' });
  }
  if (species.trim().length > MAX.species) {
    return res.status(400).json({ error: `La especie no puede superar ${MAX.species} caracteres` });
  }
  const ageNum = toFloat(age);
  if (isNaN(ageNum) || ageNum < 0 || ageNum > 100) {
    return res.status(400).json({ error: 'La edad debe ser un número entre 0 y 100' });
  }
  const rationNum = toFloat(ration);
  const weightNum = toFloat(weight);

  const pet = await prisma.pet.create({
    data: {
      name: name.trim(),
      species: species.trim(),
      breed: typeof breed === 'string' ? breed.slice(0, MAX.breed) : '',
      age: ageNum,
      ration: isNaN(rationNum) || rationNum < 0 ? 0 : Math.min(rationNum, 100000),
      weight: isNaN(weightNum) || weightNum < 0 ? null : Math.min(weightNum, 10000),
      userId: req.user.id
    }
  });

  res.status(201).json(pet);
}

async function updatePet(req, res) {
  const existing = await prisma.pet.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!existing) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }

  const { name, species, breed, age, ration, weight } = req.body;
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'El nombre no es válido' });
    }
    if (name.trim().length > MAX.name) {
      return res.status(400).json({ error: `El nombre no puede superar ${MAX.name} caracteres` });
    }
    data.name = name.trim();
  }
  if (species !== undefined) {
    if (typeof species !== 'string' || !species.trim()) {
      return res.status(400).json({ error: 'La especie no es válida' });
    }
    if (species.trim().length > MAX.species) {
      return res.status(400).json({ error: `La especie no puede superar ${MAX.species} caracteres` });
    }
    data.species = species.trim();
  }
  if (breed !== undefined) data.breed = typeof breed === 'string' ? breed.slice(0, MAX.breed) : '';
  if (age !== undefined) {
    const ageNum = toFloat(age);
    if (isNaN(ageNum) || ageNum < 0 || ageNum > 100) {
      return res.status(400).json({ error: 'La edad debe ser un número entre 0 y 100' });
    }
    data.age = ageNum;
  }
  if (ration !== undefined) {
    const rationNum = toFloat(ration);
    if (isNaN(rationNum) || rationNum < 0) {
      return res.status(400).json({ error: 'La ración debe ser un número no negativo' });
    }
    data.ration = Math.min(rationNum, 100000);
  }
  if (weight !== undefined) {
    const weightNum = toFloat(weight);
    data.weight = isNaN(weightNum) || weightNum < 0 ? null : Math.min(weightNum, 10000);
  }

  const pet = await prisma.pet.update({ where: { id: existing.id }, data });
  res.json(pet);
}

async function deletePet(req, res) {
  const existing = await prisma.pet.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!existing) {
    return res.status(404).json({ error: 'Mascota no encontrada' });
  }

  await prisma.pet.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}

module.exports = { listPets, getPet, createPet, updatePet, deletePet };